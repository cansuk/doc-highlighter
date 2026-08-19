/*
 * Doc Highlighter — highlight local and web documents, stored on your device.
 * Copyright (C) 2026 cansuk
 *
 * This program is free software: you can redistribute it and/or modify it under
 * the terms of the GNU General Public License as published by the Free Software
 * Foundation, either version 3 of the License, or (at your option) any later
 * version. See the LICENSE file, or <https://www.gnu.org/licenses/>.
 */
/**
 * Doc Highlighter — content script
 *
 * Being a SINGLE FILE is a constraint, not a preference: MV3 content_scripts do
 * not support ESM imports (there is no "type":"module"). The alternative is a
 * dynamic import plus web_accessible_resources, which leaks the extension ID to
 * the page (fingerprinting). One dependency-free file is safer.
 *
 * Sections:
 *   1  environment check
 *   2  text index   — flattens the DOM to plain text, maps offset <-> node
 *   3  anchoring    — quote (prefix/exact/suffix) + position, with fallbacks
 *   4  storage      — chrome.storage.local; top page doc:<url>, iframe doc:#<hash>
 *   5  render       — CSS Custom Highlight API; page structure is never changed
 *   6  toolbar      — mini toolbar that appears over a selection (shadow DOM)
 *   7  navigator    — docked outline + highlight list, click to jump (shadow DOM)
 *   8  notes        — sticky notes attached to a highlight (shadow overlay layer)
 *   9  markdown     — renders a raw .md document; the one deliberate DOM rewrite
 *  10  translate    — Chrome's on-device Translator; nothing is sent anywhere
  *  11  startup
 */

(() => {
  'use strict';

  // --- 1. environment check ----------------------------------------------------

  const isTextish =
    document.contentType?.startsWith('text/') || document.contentType === 'application/xhtml+xml';
  if (!isTextish) return;

  if (window.__docHighlighterLoaded) return; // the same tab can be injected twice
  window.__docHighlighterLoaded = true;

  const TAG = '[Doc Highlighter]';
  const UI_ATTR = 'data-dh-ui';
  const DEBUG_KEY = 'dhDebug';

  /* --- diagnostic logs: quiet by default, switchable --------------------------
   * Informational logs were NOT deleted, they were TURNED OFF. Every persistence
   * bug ("the highlight vanished", "it does not save") is only diagnosable through
   * these lines; deleting them means writing them from scratch next time.
   *
   * To enable, in the page console:  __docHL.setDebug(true)   then reload
   *
   * console.error and user-facing console.warn stay ON at all times — those are
   * not diagnostics but real failures. dump() always prints too, since it is
   * invoked by hand.
   * ------------------------------------------------------------------------- */
  let DEBUG = false;
  const log = (...a) => {
    if (DEBUG) console.log(...a);
  };
  function setDebug(on) {
    DEBUG = !!on;
    chrome.storage.local.set({ [DEBUG_KEY]: DEBUG });
    console.log(`${TAG} diagnostic logs ${DEBUG ? 'ON' : 'OFF'} — reload the page`);
    return DEBUG;
  }

  // Without the Custom Highlight API we cannot render at all (Chrome 105+).
  const HAS_HIGHLIGHT_API = typeof CSS !== 'undefined' && !!CSS.highlights;

  chrome.runtime.sendMessage({ type: 'content-alive', url: location.href }).catch(() => {});

  /**
   * COLOUR and UNDERLINE ARE INDEPENDENT — one highlight can carry both.
   *
   * The previous model had a single `style` field, so applying underline wiped the
   * colour. New model: { color: 'yellow'|null, underline: true|false }.
   * Old records are converted by migrate() during load(); no data is lost.
   *
   * The ORDER of the original three colours was PRESERVED and new ones appended,
   * so the user's "first swatch is yellow" muscle memory still holds.
   */
  const COLORS = ['yellow', 'green', 'pink', 'blue', 'orange', 'purple'];

  /**
   * The same six colours as data. The ::highlight rules below carry these hex
   * values too; tools/check-colors.mjs fails the build if the two ever disagree,
   * which is what makes the duplication safe.
   */
  /** The ink every highlight prints in. One value, referenced everywhere. */
  const INK = '#1f2937';
  const UNDERLINE_INK = '#e11d48';

  /** User overrides, merged over the defaults. Empty until something is changed. */
  const PALETTE_KEY = 'dhPalette';
  let custom = {};
  const swatch = (name) => custom[name] || PALETTE[name];

  const PALETTE = {
    yellow: '#ffd54a',
    green: '#8ee6a8',
    pink: '#ffa8c5',
    blue: '#9ecbff',
    orange: '#ff9c47',
    purple: '#d9c4ff',
      underline: '#e11d48',
    };

  /* ---------------------------------------------------------------------------
   * BOLD IS ON HOLD (Aug 2026)
   *
   * Status: tried by the user, did not work well. The button, its CSS and its
   *         style entry are commented out. A different approach will be considered.
   *
   * Why it is hard: `font-weight` IS NOT SUPPORTED by the CSS Custom Highlight API.
   *   ::highlight() only accepts paint properties — color, background-color,
   *   text-decoration, text-shadow, -webkit-text-stroke. font-weight is excluded
   *   from the spec because it would force reflow.
   *
   * Tried: -webkit-text-stroke-width: 0.7px  (faux bold, does not affect layout)
   *        -> did not produce the desired result.
   *
   * Alternatives to evaluate:
   *   1. text-shadow: 0 0 .4px currentColor — another faux bold; blurrier, but on
   *      some font/rendering combinations it beats text-stroke.
   *   2. -webkit-text-stroke and text-shadow together, both at low values.
   *   3. Colour + contrast: convey emphasis with a darker background-color instead
   *      of real weight (the only solid route within the API limits).
   *   4. DOM wrapping (<strong>) — gives REAL bold but was REJECTED: it mutates the
   *      page structure, produces nested markup for selections that cross element
   *      boundaries, and collides with SPA re-renders. It contradicts the engine's
   *      core design decision; reopening it must be a deliberate choice.
   *
   * Data note: highlights previously stored with style:'bold' ARE NOT DELETED,
   * they simply are not painted (paint() skips unknown styles). If bold returns,
   * those records reappear on their own.
   * ------------------------------------------------------------------------- */

  const msg = (key, fallback) => chrome.i18n.getMessage(key) || fallback;

  // --- 2. text index -----------------------------------------------------

  /** Flattens the visible DOM text into one string, keeping each text node's range. */
  function buildIndex() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (!n.nodeValue) return NodeFilter.FILTER_REJECT;
        const p = n.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        if (p.closest(`[${UI_ATTR}]`)) return NodeFilter.FILTER_REJECT; // our own UI
        const tag = p.tagName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    const nodes = [];
    const byNode = new Map();
    let text = '';

    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const entry = { node: n, start: text.length, end: text.length + n.nodeValue.length };
      text += n.nodeValue;
      nodes.push(entry);
      byNode.set(n, entry);
    }

    return { text, nodes, byNode };
  }

  /** Global offset -> {node, offset}. Binary search, since nodes are ordered. */
  function locate(index, offset) {
    let lo = 0;
    let hi = index.nodes.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const e = index.nodes[mid];
      if (offset < e.start) hi = mid - 1;
      else if (offset > e.end) lo = mid + 1;
      else return { node: e.node, offset: offset - e.start };
    }
    return null;
  }

  /** Selection Range -> global offset pair. Element boundaries are reduced to text nodes. */
  function rangeToOffsets(index, range) {
    const edge = (container, offset, atStart) => {
      if (container.nodeType === Node.TEXT_NODE) {
        const e = index.byNode.get(container);
        return e ? e.start + offset : null;
      }
      // At an element boundary: descend to the first/last text node inside it.
      const child = container.childNodes[atStart ? offset : offset - 1];
      const scope = child ?? container;
      const w = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
      let found = null;
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        if (index.byNode.has(n)) {
          found = index.byNode.get(n);
          if (atStart) break;
        }
      }
      if (!found && index.byNode.has(scope)) found = index.byNode.get(scope);
      return found ? (atStart ? found.start : found.end) : null;
    };

    const start = edge(range.startContainer, range.startOffset, true);
    const end = edge(range.endContainer, range.endOffset, false);
    return start == null || end == null || end <= start ? null : { start, end };
  }

  function offsetsToRange(index, start, end) {
    const a = locate(index, start);
    const b = locate(index, end);
    if (!a || !b) return null;
    const r = document.createRange();
    try {
      r.setStart(a.node, a.offset);
      r.setEnd(b.node, b.offset);
    } catch {
      return null;
    }
    return r;
  }

  // --- 3. anchoring ---------------------------------------------------------

  const CTX = 32; // prefix/suffix length

  function makeAnchor(index, start, end) {
    return {
      exact: index.text.slice(start, end),
      prefix: index.text.slice(Math.max(0, start - CTX), start),
      suffix: index.text.slice(end, Math.min(index.text.length, end + CTX)),
      start,
      end,
    };
  }

  /**
   * Locates an anchor in the current text.
   *
   * Order: (1) if it still sits exactly at the stored offset, take it — cheapest.
   *        (2) otherwise find every occurrence of `exact`, score them by
   *            prefix/suffix overlap plus proximity to the old position, pick the best.
   * If nothing matches, null -> the highlight counts as an "orphan"; DATA IS KEPT.
   */
  function resolveAnchor(index, a) {
    if (!a?.exact) return null;

    if (index.text.slice(a.start, a.end) === a.exact) return { start: a.start, end: a.end };

    const hits = [];
    for (let i = index.text.indexOf(a.exact); i !== -1; i = index.text.indexOf(a.exact, i + 1)) {
      hits.push(i);
      if (hits.length > 400) break; // stop in pathological cases
    }
    if (hits.length === 0) return null;

    let best = null;
    for (const i of hits) {
      const pre = index.text.slice(Math.max(0, i - CTX), i);
      const suf = index.text.slice(i + a.exact.length, i + a.exact.length + CTX);
      const score =
        commonSuffixLen(pre, a.prefix) * 2 +
        commonPrefixLen(suf, a.suffix) * 2 -
        Math.min(50, Math.abs(i - a.start) / 40);
      if (!best || score > best.score) best = { score, start: i, end: i + a.exact.length };
    }
    return best ? { start: best.start, end: best.end } : null;
  }

  const commonPrefixLen = (a, b) => {
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    return i;
  };
  const commonSuffixLen = (a, b) => {
    let i = 0;
    while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
    return i;
  };

  // --- 4. storage ----------------------------------------------------------
  // chrome.storage.local: owned by the extension, invisible to the page, never
  // leaves the device, survives closing the tab or the browser. NOT a cookie and
  // NOT the page localStorage (a cookie is sent to the server on every request;
  // the site itself can wipe its own localStorage).

  function normalizeUrl(href) {
    try {
      const u = new URL(href);
      u.hash = '';
      const junk = /^(utm_|fbclid|gclid|igshid|mc_cid|mc_eid|ref_src|_ga)/i;
      for (const k of [...u.searchParams.keys()]) if (junk.test(k)) u.searchParams.delete(k);
      return u.toString();
    } catch {
      return href;
    }
  }

  async function sha256(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
  }

  /**
   * KEY DESIGN — URL is the primary key, content hash is the secondary index.
   *
   * The opposite was tried first (hash as primary) and produced fragmentation: when
   * the content changed the hash changed, the record was written under a new key
   * and the old one became garbage. A URL is STABLE for a document; it stays the
   * same even when the content changes.
   *
   *   doc:<normalizedUrl>  -> { url, contentHash, title, updatedAt, highlights[] }
   *   hash:<contentHash>   -> <normalizedUrl>
   *
   * If a file is moved or renamed the URL changes but the hash does not; the hash
   * index finds the old record and the record is MIGRATED to the new URL (self-heal).
   */
  const docKey = (url) => `doc:${url}`;
  const hashKey = (hash) => `hash:${hash}`;

  /* --- FRAME NOTU -----------------------------------------------------------
   * Inside an iframe the key strategy is INVERTED.
   *
   * Measured cause: Claude artifact pages render their content in a sandboxed
   * iframe on a separate origin, and that frame's URL changes on every load
   *   .../?__frame_t=rxKnsYEOTV85xNjkfCgVSbsG.9627765b-...
   * With the URL as primary key the highlights would vanish on every open and a
   * garbage record would pile up in storage on every load.
   *
   * In a frame the CONTENT is stable and the URL is volatile. On a top-level page
   * it is the other way round (stable URL, content may change). Hence:
   *
   *   top page -> doc:<normalizedUrl>   (hash as secondary index: file moved)
   *   iframe   -> doc:#<contentHash>    (the URL index is NOT written — it would
   *                                      only produce garbage)
   *
   * Reading the top page URL from inside the frame IS NOT POSSIBLE: a cross-origin
   * frame cannot access top.location.
   * ------------------------------------------------------------------------- */
  const IN_FRAME = window !== window.top;
  const frameKey = (hash) => `doc:#${hash}`;

  /**
   * Do no work at all in empty or tiny frames. With allFrames:true the script runs
   * in dozens of places — ad frames, tracking pixels, empty embeds. Building a text
   * index and attaching a MutationObserver in each of them is not free.
   */
  const MIN_FRAME_TEXT = 100;

  /**
   * When the extension is reloaded (chrome://extensions -> reload), the content
   * script in already-open pages becomes a "zombie": it is still on the page, but
   * every chrome.* API throws "Extension context invalidated". Swallowing that
   * silently leaves the user clicking with nothing happening.
   */
  function contextAlive() {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  }

  const isInvalidated = (err) => /Extension context invalidated|context invalidated/i.test(err?.message ?? '');

  let state = {
    hash: null,
    url: normalizeUrl(location.href),
    highlights: [], // { id, style, anchor }
    foundVia: null, // 'hash' | 'url (icerik degismis)' | 'BULUNAMADI'
  };

  /**
   * URL and content are tracked together:
   *   URL  -> "which document"
   *   hash -> "is it still the same document"
   * A hash mismatch DOES NOT DELETE anything; it only means re-anchoring is needed.
   * If the URL does not match but the hash does (file moved or renamed) the record
   * is still found and the URL index is updated — this is the "as long as the same
   * content exists" behaviour.
   */
  /**
   * Converts the old single-field record ({style}) to the new model
   * ({color, underline}).
   *
   * Lossless and idempotent. An unknown style (e.g. the on-hold 'bold') is kept
   * as-is in the color field: it is not in COLORS so it is not painted, but it is
   * NOT DELETED — if that style returns, the record shows up again by itself.
   */
  function migrate(h) {
    if (h.color !== undefined || h.underline !== undefined) return h;
    const { style, ...rest } = h;
    return style === 'underline'
      ? { ...rest, color: null, underline: true }
      : { ...rest, color: style ?? null, underline: false };
  }

  async function load(index) {
    state.hash = await sha256(index.text.replace(/\s+/g, ' ').trim());

    if (IN_FRAME) {
      // Frame: the content hash is primary. The URL may be volatile; no index written.
      const k = frameKey(state.hash);
      const got = await chrome.storage.local.get(k);
      let rec = got[k];
      let via = 'frame-hash';

      // Fallback for frames with a stable URL, and for older records.
      if (!rec) {
        const byUrl = await chrome.storage.local.get(docKey(state.url));
        rec = byUrl[docKey(state.url)];
        if (rec) via = 'frame-url';
      }

      state.foundVia = rec ? via : 'BULUNAMADI';
      state.highlights = (rec?.highlights ?? []).map(migrate);
      return;
    }

    // 1) Look up by URL — the common case; finds it even if the content changed.
    const byUrl = await chrome.storage.local.get(docKey(state.url));
    let rec = byUrl[docKey(state.url)];
    let via = 'url';

    // 2) If not found, look up by hash — the file may have been moved or renamed.
    if (!rec) {
      const idx = await chrome.storage.local.get(hashKey(state.hash));
      const mappedUrl = idx[hashKey(state.hash)];
      if (mappedUrl) {
        const byHash = await chrome.storage.local.get(docKey(mappedUrl));
        rec = byHash[docKey(mappedUrl)];
        via = 'hash (dosya tasinmis)';
        state.migratedFrom = mappedUrl;
      }
    }

    state.foundVia = rec ? via : 'BULUNAMADI';
    state.highlights = (rec?.highlights ?? []).map(migrate);

    // Found via hash: migrate the record to the new URL and drop the old one (self-heal).
    if (rec && state.migratedFrom && state.migratedFrom !== state.url) {
      await save();
      await chrome.storage.local.remove(docKey(state.migratedFrom));
      log(`${TAG} kayit tasindi: ${state.migratedFrom} -> ${state.url}`);
    }
  }

  async function save() {
    if (!contextAlive()) return void reportDead();

    const rec = {
      url: location.href,
      urlNormalized: state.url,
      contentHash: state.hash,
      title: document.title,
      updatedAt: new Date().toISOString(),
      highlights: state.highlights,
    };

    // In a frame the URL index is NOT written: a volatile URL would leave a new
    // garbage record on every load (see FRAME NOTE).
    const payload = IN_FRAME
      ? { [frameKey(state.hash)]: rec }
      : { [docKey(state.url)]: rec, [hashKey(state.hash)]: state.url };

    try {
      await chrome.storage.local.set(payload);
    } catch (err) {
      if (isInvalidated(err)) return void reportDead();
      console.error(`${TAG} kaydedilemedi:`, err);
    }
  }

  // --- 5. render ------------------------------------------------------------
  // CSS Custom Highlight API: paints WITHOUT touching the DOM at all. Chosen over
  // DOM wrapping (<mark>) because it does not mutate the page structure, does not
  // create nested markup for selections crossing element boundaries, and does not
  // collide with SPA re-renders.

  const live = new Map(); // id -> { style, range }

  /**
   * Written out rather than hand-maintained. That is what makes the palette
   * customisable at all: one colour value now produces BOTH the ::highlight rule
   * and the inline-gap fill rule, so the two cannot drift apart.
   */
  function paletteCss() {
    const rules = COLORS.map(
      (c) => `::highlight(dh-${c}) { background-color: ${swatch(c)}; color: ${INK}; }`,
    );
    rules.push(
      `::highlight(dh-underline) { text-decoration: underline 2px ${swatch('underline') || UNDERLINE_INK}; }`,
    );
    // Inline gap fill — see the INLINE GAP FILL note. These paint the ELEMENT,
    // which is the only way to cover its padding; the highlight API cannot.
    for (const c of COLORS) {
      rules.push(
        `[data-dh-fill="${c}"] { background-color: ${swatch(c)} !important; color: ${INK} !important; }`,
      );
    }
    return rules.join('\n');
  }

  /** Re-paints after the palette is changed from the popup. */
  function refreshPalette() {
    const el = document.getElementById('dh-styles');
    if (el) el.textContent = paletteCss();
    refreshToolbarSwatches();
    renderPanelSafe();
  }
  function ensureStyleSheet() {
    if (document.getElementById('dh-styles')) return;
    // ::highlight() accepts ONLY paint properties: color, background-color,
    // text-decoration, text-shadow, -webkit-text-stroke. font-weight IS NOT
    // SUPPORTED (it would force reflow) — which is why "bold" was attempted as a
    // faux bold via -webkit-text-stroke. Real font-weight would require wrapping
    // the DOM in <strong>, which breaks the page structure.
    // The palette is measured, not eyeballed (tools/check-colors.mjs):
    //  - every colour reaches WCAG AAA (>= 7:1) against the #1f2937 ink
    //  - pairwise luminance gaps are kept apart so the colours remain
    //    distinguishable under colour vision deficiency. On the first attempt pink
    //    and orange had EXACTLY the same luminance (gap 0.000) — orange was
    //    darkened to separate them.
    const css = `
      ${paletteCss()}

      /* Focus frame shown after jumping from the navigator panel. A frame cannot be
         drawn with ::highlight() — that API ignores border and outline — so this
         animates a real, short-lived overlay element instead. */
      @keyframes dh-focus {
        0%   { opacity: 0; transform: scale(1.06); }
        18%  { opacity: 1; transform: scale(1); }
        70%  { opacity: 1; }
        100% { opacity: 0; }
      }
    `;
    // ERTELENDI: ::highlight(dh-bold) { -webkit-text-stroke-width: 0.7px; }
    const el = document.createElement('style');
    el.id = 'dh-styles';
    el.setAttribute(UI_ATTR, '');
    el.textContent = css;
    document.head?.appendChild(el) ?? document.documentElement.appendChild(el);
  }

  /**
   * Colour and underline are written to SEPARATE highlight registries; one range
   * can live in both. In the CSS Custom Highlight API a range may belong to several
   * Highlights, and different properties (background-color vs text-decoration)
   * combine without conflict — that is how "yellow AND underlined" works.
   */
  function paint() {
    if (!HAS_HIGHLIGHT_API) return;

    for (const key of COLORS) {
      const ranges = [...live.values()].filter((h) => h.color === key).map((h) => h.range);
      if (ranges.length) CSS.highlights.set(`dh-${key}`, new Highlight(...ranges));
      else CSS.highlights.delete(`dh-${key}`);
    }

    const underlined = [...live.values()].filter((h) => h.underline).map((h) => h.range);
    if (underlined.length) CSS.highlights.set('dh-underline', new Highlight(...underlined));
    else CSS.highlights.delete('dh-underline');
  }

  /* --- INLINE GAP FILL -------------------------------------------------------
   * ::highlight() paints TEXT RUNS. An inline element's own padding and margin are
   * not text runs, so they stay unpainted: selecting a whole line that contains
   * `code` chips leaves a bare strip on each side of every chip.
   *
   * Measured, so the reasoning is not guesswork:
   *   padding: 6px  -> gap on both sides
   *   padding: 0    -> continuous
   *   margin: 6px   -> gap on both sides
   * A thick text-decoration does not bridge it either (also measured).
   *
   * The only fix is to paint the element itself. We do NOT wrap anything: an
   * attribute is set on elements FULLY inside the range, and a stylesheet paints
   * them. Page structure is untouched, so anchoring, cross-element selections and
   * copied text are all unaffected.
   *
   * Scope is deliberately narrow — only inline-level elements that actually have
   * horizontal padding or margin, i.e. only the ones that would leave a gap.
   * Partially covered elements are skipped; painting them whole would colour text
   * the user did not select.
   *
   * No observer loop: watchDom() listens for childList/characterData, not attributes.
   */
  const FILL_ATTR = 'data-dh-fill';

  function fillInlineGaps() {
    for (const el of document.querySelectorAll(`[${FILL_ATTR}]`)) el.removeAttribute(FILL_ATTR);

    for (const h of live.values()) {
      if (!h.color) continue; // underline alone leaves no gap to fill

      const root = h.range.commonAncestorContainer;
      const scope = root.nodeType === Node.ELEMENT_NODE ? root : root.parentElement;
      if (!scope) continue;

      for (const el of scope.querySelectorAll('*')) {
        if (el.closest(`[${UI_ATTR}]`)) continue;
        if (!isFullyInside(h.range, el)) continue;

        const cs = getComputedStyle(el);
        if (!cs.display.startsWith('inline')) continue;
        const spaced =
          parseFloat(cs.paddingLeft) || parseFloat(cs.paddingRight) ||
          parseFloat(cs.marginLeft) || parseFloat(cs.marginRight);
        if (!spaced) continue;

        el.setAttribute(FILL_ATTR, h.color);
      }
    }
  }

  function isFullyInside(range, el) {
    try {
      return range.comparePoint(el, 0) === 0 && range.comparePoint(el, el.childNodes.length) === 0;
    } catch {
      return false; // comparePoint throws when the node sits in another tree
    }
  }

  /** Binds stored anchors to the current DOM. Anything that fails is reported as an orphan. */
  function applyAll(index) {
    live.clear();
    let orphan = 0;

    for (const h of state.highlights) {
      const hit = resolveAnchor(index, h.anchor);
      const range = hit && offsetsToRange(index, hit.start, hit.end);
      // Resolved offsets are kept too: duplicate/overlapping selection detection
      // (see findOverlapping) is impossible without them.
      if (range) live.set(h.id, { color: h.color, underline: h.underline, range, start: hit.start, end: hit.end });
      else orphan++;
    }

    paint();
    fillInlineGaps();
    refreshPanel(index);
    renderNoteDots();
    // log(), NOT console.warn(): an orphan is not a failure, it is expected
    // behaviour (the page text changed). Left as a warn it landed in the
    // chrome://extensions Errors list and drowned out real errors. The count is
    // already visible in the "ready" summary line and in dump().
    if (orphan) log(`${TAG} ${orphan} highlight bu sayfada bulunamadi (orphan) — veri silinmedi`);
    return orphan;
  }

  // --- 6. toolbar -----------------------------------------------------------
  // Shadow DOM: so the page CSS cannot break the toolbar, and our CSS cannot break the page.

  let host = null;
  let shadow = null;

  // Lucide "eraser" — ISC, (c) Lucide Icons and Contributors (see NOTICE).
  const ERASER =
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M21 21H8a2 2 0 0 1-1.42-.587l-3.994-3.999a2 2 0 0 1 0-2.828l10-10a2 2 0 0 1 2.829 0' +
    'l5.999 6a2 2 0 0 1 0 2.828L12.834 21"/><path d="m5.082 11.09 8.828 8.828"/></svg>';

  // Lucide "languages" — ISC, (c) Lucide Icons and Contributors (see NOTICE).
  const GLOBE_ICON =
    '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/>' +
    '<path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg>';
  // Lucide "message-square" — ISC, (c) Lucide Icons and Contributors (see NOTICE).
  const NOTE_ICON =
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';

  function buildToolbar() {
    host = document.createElement('div');
    host.setAttribute(UI_ATTR, '');
    host.style.cssText = 'position:absolute;z-index:2147483647;top:0;left:0;display:none';
    shadow = host.attachShadow({ mode: 'closed' });

    shadow.innerHTML = `
      <style>
        /* The toolbar covers the line ABOVE the selection. A translucent black
           background plus blur keeps the text behind it readable while the buttons
           stay crisp. If backdrop-filter is unsupported the plain rgba fill
           takes over. */
        .bar { display:flex; gap:4px; align-items:center; padding:5px;
               background:rgba(18,20,24,.62);
               -webkit-backdrop-filter:blur(8px) saturate(1.3);
               backdrop-filter:blur(8px) saturate(1.3);
               border:1px solid rgba(255,255,255,.14);
               border-radius:10px; box-shadow:0 6px 20px rgba(0,0,0,.28);
               font:12px system-ui,sans-serif; }
        button { width:24px; height:24px; border-radius:6px; border:1px solid rgba(255,255,255,.22);
                 cursor:pointer; padding:0; display:grid; place-items:center; background:transparent; }
        button:hover { outline:2px solid rgba(255,255,255,.55); }
        /* Active style: white ring. Colour and underline can be active AT THE SAME TIME. */
        button.on { outline:2px solid #fff; outline-offset:1px; }
        .u  { color:#fff; font-size:13px; text-decoration:underline 2px #e11d48; }
        .b  { color:#fff; font-size:13px; font-weight:800; }
        .rm { color:#fff; font-size:15px; line-height:1; }
        .tr { width:auto; padding:0 6px; gap:4px; color:#fff; display:flex; align-items:center; }
        .tr svg { display:block; }
        .tr .code { font-size:9px; font-weight:700; letter-spacing:.04em; }
        .lg { width:16px; color:#fff; font-size:10px; }
        /* The target list opens inside the toolbar rather than over the page: the toolbar
           is already positioned against the selection, so the list needs no geometry. */
        .langs { position:absolute; top:100%; right:0; margin-top:4px; z-index:1;
                 max-height:190px; overflow-y:auto; display:flex; flex-direction:column;
                 background:rgba(18,20,24,.96); border:1px solid rgba(255,255,255,.16);
                 border-radius:9px; padding:4px; min-width:132px; }
        .langs button { width:100%; height:auto; padding:5px 8px; border:0; border-radius:6px;
                        color:#fff; font-size:12px; text-align:left; background:transparent; }
        .langs button:hover { background:rgba(255,255,255,.14); outline:none; }
        .langs button.on { background:rgba(255,255,255,.2); font-weight:700; }
        .nt { color:#fff; }
        .nt svg { display:block; }
        .clr{ color:#fff; }
        .clr svg { display:block; }
        /* Awaiting confirmation: the button turns into text and takes the danger
           colour. Native confirm() IS NOT USED — a modal dialog locks the page and
           is bad behaviour in a content script. A two-step button is enough. */
        .clr.armed { width:auto; padding:0 9px; gap:5px; font-size:12px; font-weight:600;
                     background:#c5221f; border-color:transparent; white-space:nowrap; }
        .sep{ width:1px; height:18px; background:rgba(255,255,255,.25); margin:0 2px; }
        .bar.dead { color:#ffd54a; padding:8px 12px; max-width:280px; line-height:1.4; }
      </style>
      <div class="bar">
        ${COLORS.map(
          (c) =>
            `<button data-color="${c}" style="background:${swatch(c)}" title="${msg(
              'tb' + c[0].toUpperCase() + c.slice(1),
              c,
            )}"></button>`,
        ).join('')}
        <span class="sep"></span>
        <button data-act="underline" class="u" title="${msg('tbUnderline', 'Underline')}">U</button>
        <!-- ERTELENDI (bkz. "BOLD ERTELENDI" notu):
        <button data-act="bold" class="b" title="${msg('tbBold', 'Bold')}">B</button> -->
        <span class="sep"></span>
        <button data-act="note" class="nt" title="${msg('tbNote', 'Note')}">${NOTE_ICON}</button>
        <button data-act="translate" class="tr" title="${msg('tbTranslate', 'Translate')}">${GLOBE_ICON}<span class="code"></span></button>
        <button data-act="lang" class="lg" title="${msg('tbTargetLang', 'Target language')}">▾</button>
        <span class="sep"></span>
        <button data-act="clear-all" class="clr" title="${msg('tbClearAll', 'Clear all highlights on this page')}">${ERASER}</button>
        <button data-act="remove" class="rm" title="${msg('tbRemove', 'Remove')}">×</button>
      </div>`;

    document.documentElement.appendChild(host);

    shadow.addEventListener('mousedown', (e) => e.preventDefault()); // keep the selection alive
    shadow.addEventListener('click', onToolbarClick);
  }

  let pendingRange = null; // range coming from the selection
  let hoveredId = null; // the existing highlight that was clicked
  let dead = false; // extension context invalidated

  /**
   * Zombie state: the extension was reloaded and the script on this page is cut
   * off. Turns the toolbar into a notice, so the user is not left clicking with
   * nothing happening.
   */
  /** Toolbar swatches carry inline colours, so they do not follow the stylesheet. */
  function refreshToolbarSwatches() {
    if (!shadow) return;
    for (const b of shadow.querySelectorAll('button[data-color]')) {
      b.style.background = swatch(b.dataset.color);
    }
  }
  function reportDead() {
    if (dead) return;
    dead = true;
    console.warn(
      `${TAG} extension yeniden yuklendi, bu sayfadaki baglanti koptu. ` +
        `Sayfayi yenile (F5) — kayitli highlight'lar duruyor, kaybolmadi.`,
    );
    if (shadow) {
      const bar = shadow.querySelector('.bar');
      if (bar) {
        bar.classList.add('dead');
        bar.textContent = msg('tbReload', 'Extension reloaded — refresh the page (F5)');
      }
    }
  }

  /**
   * Places the toolbar above the selection and keeps it INSIDE the viewport.
   *
   * The width is measured and clamped: with 6 colours plus underline and delete the
   * bar grew to ~250px and overflowed the screen for selections near the right
   * edge. Show first, measure offsetWidth, then position — assuming a fixed number
   * would be wrong because the width varies with theme and language.
   */
  function showToolbar(rect) {
  // Prepared here, off the click. See the note on detectedSource.
    prepareSource();
    host.style.display = 'block';

    const w = host.offsetWidth || 250;
    const maxLeft = window.scrollX + document.documentElement.clientWidth - w - 8;
    const left = Math.min(Math.max(window.scrollX + 8, window.scrollX + rect.left), Math.max(8, maxLeft));

    // If there is no room above the selection, place it below — do not clip at the top.
    const above = window.scrollY + rect.top - 42;
    const below = window.scrollY + rect.bottom + 8;
    const top = above < window.scrollY + 4 ? below : above;

    host.style.top = `${top}px`;
    host.style.left = `${left}px`;
  }

  /**
   * Detects the language of the current selection in the background, so pressing
   * translate does not have to wait for it. Failure is silent on purpose: this is
   * preparation, not the operation, and the fallback is the document language.
   */
  function prepareSource() {
    detectedSource = null;
    const text = (pendingRange ?? getSelection()?.getRangeAt?.(0))?.toString?.().trim();
    if (!text || !hasTranslator()) return;
    detectLang(text).then(
      (code) => {
        detectedSource = code;
      },
      () => {},
    );
  }
  function hideToolbar() {
  shadow?.querySelector('.langs')?.remove();
    if (host) host.style.display = 'none';
    pendingRange = null;
    hoveredId = null;
    disarmClear();
  }

  /* --- "clear all" two-step confirmation --------------------------------------
   * Deleting every highlight on the page IS IRREVERSIBLE and must not happen on a
   * single click. Native confirm() is not used either: a modal dialog locks the page.
   * Solution: the first click turns the button into "Delete all N?", the second
   * applies it. If it is not confirmed within 4 seconds it reverts on its own, so it
   * cannot stay armed and delete on some later click.
   */
  let clearArmed = false;
  let clearTimer = null;

  function disarmClear() {
    clearArmed = false;
    clearTimeout(clearTimer);
    const btn = shadow?.querySelector('[data-act="clear-all"]');
    if (btn) {
      btn.classList.remove('armed');
      btn.innerHTML = ERASER;
      btn.title = msg('tbClearAll', 'Clear all highlights on this page');
    }
  }

  function armClear(count) {
    const btn = shadow?.querySelector('[data-act="clear-all"]');
    if (!btn) return;
    clearArmed = true;
    btn.classList.add('armed');
    btn.textContent = msg('tbClearAllArmed', 'Delete all?').replace('{n}', String(count));
    btn.title = msg('tbClearAllArmedHint', 'Click again to confirm');
    clearTimeout(clearTimer);
    clearTimer = setTimeout(disarmClear, 4000);
  }

  async function onToolbarClick(e) {
    const btn = e.target.closest('button');
    if (!btn) return;

    if (btn.dataset.act === 'clear-all') {
      if (!clearArmed) {
        if (state.highlights.length === 0) return; // nothing to delete
        armClear(state.highlights.length);
        return; // the toolbar STAYS OPEN — the second click is the confirmation
      }
      await clearPage();
      hideToolbar();
      getSelection()?.removeAllRanges();
      return;
    }

    // Pressing any other button cancels a pending clear-all.
    disarmClear();

    if (btn.dataset.act === 'translate') {
      await translateSelection();
      hideToolbar();
      return;
    }

    if (btn.dataset.act === 'lang') {
      toggleLangMenu();
      return; // the toolbar STAYS OPEN — a list you cannot read is no list
    }

    if (btn.dataset.lang) {
      await setTargetLang(btn.dataset.lang);
      return;
    }
    if (btn.dataset.act === 'note') {
      await addNoteFromToolbar();
      hideToolbar();
      return;
    }

    if (btn.dataset.act === 'remove') {
      if (hoveredId) await removeHighlight(hoveredId);
      hideToolbar();
      return;
    }

    // patch = what should change. Colour and underline are INDEPENDENT: pressing a
    // colour does not affect the underline, and vice versa.
    const patch = btn.dataset.color
      ? { color: btn.dataset.color }
      : btn.dataset.act === 'underline'
        ? { underline: true }
        : null;
    if (!patch) return;

    if (hoveredId) await patchHighlight(hoveredId, patch);
    else if (pendingRange) await applyToSelection(pendingRange, patch);

    hideToolbar();
    getSelection()?.removeAllRanges();
  }

  /** Shows which colour / underline is ACTIVE on the toolbar. */
  function markActive(h) {
    if (!shadow) return;
    for (const b of shadow.querySelectorAll('button')) {
      const on = h && ((b.dataset.color && b.dataset.color === h.color) || (b.dataset.act === 'underline' && h.underline));
      b.classList.toggle('on', !!on);
    }
  }

  // --- operations -------------------------------------------------------------

  const byId = (id) => (id ? state.highlights.find((h) => h.id === id) : null);

  const newId = () => `h_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`;

  /**
   * Finds an existing highlight that substantially overlaps the given range.
   *
   * A ratio is used instead of exact equality: when the user selects the same text
   * a second time the boundaries never match exactly (leading/trailing whitespace,
   * double-click word selection). 75% overlap is enough to count as "the same spot".
   */
  function findOverlapping(start, end) {
    for (const [id, h] of live) {
      const overlap = Math.min(end, h.end) - Math.max(start, h.start);
      if (overlap <= 0) continue;
      const ratio = overlap / Math.min(end - start, h.end - h.start);
      if (ratio >= 0.75) return { id };
    }
    return null;
  }

  /**
   * Updates an existing highlight.
   *
   *   { color: 'yellow' }  -> REMOVES the colour if it is already yellow, otherwise sets it
   *   { underline: true }  -> toggles the underline
   *
   * Neither erases the other: adding an underline to a yellow highlight keeps the
   * yellow. If neither a colour nor an underline is left, the highlight has nothing
   * to show and is deleted.
   */
  async function patchHighlight(id, patch) {
    const h = state.highlights.find((x) => x.id === id);
    if (!h) return;

    if (patch.color) h.color = h.color === patch.color ? null : patch.color;
    if (patch.underline) h.underline = !h.underline;
    // A note is SET, not toggled: an empty string means "remove the note".
    if (patch.note !== undefined) {
      h.note = patch.note.trim() || undefined;
      // Where it came from travels with it, and goes when it goes.
      if (!h.note) delete h.noteFrom;
      else if (patch.noteFrom) h.noteFrom = patch.noteFrom;
    }

    if (!h.color && !h.underline && !h.note) {
      state.highlights = state.highlights.filter((x) => x.id !== id);
      log(`${TAG} stil kalmadi -> highlight kaldirildi`);
    }

    await save();
    applyAll(buildIndex());
  }

  /** Applies a style to the selection. If a highlight already covers that spot it is updated, not duplicated. */
  async function applyToSelection(range, patch) {
    const index = buildIndex();
    const off = rangeToOffsets(index, range);
    if (!off) {
      console.warn(`${TAG} secim cozumlenemedi`);
      return;
    }

    const existing = findOverlapping(off.start, off.end);
    if (existing) {
      await patchHighlight(existing.id, patch);
      return existing.id;
    }

    const h = {
      id: newId(),
      color: patch.color ?? null,
      underline: !!patch.underline,
      note: patch.note?.trim() || undefined,
            noteFrom: patch.note?.trim() ? patch.noteFrom : undefined,
      anchor: makeAnchor(index, off.start, off.end),
      createdAt: Date.now(),
    };
    state.highlights.push(h);
    await save();
    applyAll(index);
    log(`${TAG} highlight eklendi (${h.color ?? '-'}${h.underline ? ' + underline' : ''}):`, h.anchor.exact.slice(0, 40));
    return h.id;
  }

  async function removeHighlight(id) {
    state.highlights = state.highlights.filter((h) => h.id !== id);
    await save();
    applyAll(buildIndex());
  }

  /**
   * Deletes EVERY highlight on this page.
   *
   * Instead of leaving an empty record behind, the storage KEYS are removed:
   * otherwise every cleared page would accumulate an empty entry. On a top-level
   * page both the doc: and hash: keys go; in a frame only the doc:# key (a frame
   * never writes a URL index — see FRAME NOTE).
   */
  async function clearPage() {
    const n = state.highlights.length;
    state.highlights = [];

    if (!contextAlive()) return void reportDead();

    try {
      await chrome.storage.local.remove(
        IN_FRAME ? [frameKey(state.hash)] : [docKey(state.url), hashKey(state.hash)],
      );
    } catch (err) {
      if (isInvalidated(err)) return void reportDead();
      console.error(`${TAG} temizlenemedi:`, err);
      return;
    }

    applyAll(buildIndex());
    log(`${TAG} sayfadaki ${n} highlight temizlendi`);
    return n;
  }

  /** The Custom Highlight API has no hit testing; point -> highlight mapping is done by hand. */
  function highlightAt(x, y) {
    for (const [id, h] of live) {
      for (const r of h.range.getClientRects()) {
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return id;
      }
    }
    return null;
  }

  // --- 7. navigator panel ----------------------------------------------------
  // A docked panel listing the document outline and every highlight, with click to
  // jump. Shadow DOM for the same reason as the toolbar: the page cannot restyle it
  // and it cannot restyle the page.
  //
  // TOP FRAME ONLY. Inside an iframe the panel would be trapped in the frame's box,
  // and pages that embed their content would end up with two of them. One navigator
  // per tab is the only sensible reading.

  const PREFS_KEY = 'dhPanelPrefs';
  const prefs = { side: 'right', theme: 'auto', open: true, preview: true };

  // Widths live here, not only in CSS: the page needs the same numbers to reserve
  // room for the panel, and two hand-kept copies would drift apart.
  const PANEL_W = 300;
  const HANDLE_W = 32;

  let pHost = null;
  let pShadow = null;
  let pTab = 'toc'; // 'toc' | 'marks'
  let tocItems = [];

  const isTopFrame = (() => {
    try {
      return window.top === window;
    } catch {
      return false;
    }
  })();

  async function loadPrefs() {
    if (!contextAlive()) return;
    try {
      const got = await chrome.storage.local.get(PREFS_KEY);
      Object.assign(prefs, got[PREFS_KEY] ?? {});
    } catch (e) {
      if (!isInvalidated(e)) log(`${TAG} panel tercihleri okunamadi`, e);
    }
  }

  async function savePrefs() {
    if (!contextAlive()) return;
    try {
      await chrome.storage.local.set({ [PREFS_KEY]: { ...prefs } });
    } catch (e) {
      if (!isInvalidated(e)) log(`${TAG} panel tercihleri yazilamadi`, e);
    }
  }

  /* --- outline extraction -----------------------------------------------------
   * Two sources, because a local .md file has NO headings in the DOM.
   *
   *   rendered document -> real <h1>..<h6> elements
   *   raw .md / .txt    -> Chrome renders the file as plain text inside a single
   *                        <pre>. There are no heading elements at all, so the
   *                        "# " syntax is read out of the flattened index text.
   *
   * The raw case is the one that matters most: reading local Markdown is why this
   * extension exists, and most people open those files with no viewer installed.
   * -------------------------------------------------------------------------- */

  /** True when the page is a plain-text document rendered by Chrome itself. */
  function isRawTextDocument() {
    const pres = document.body?.querySelectorAll?.('pre');
    if (!pres || pres.length !== 1) return false;
    const bodyLen = (document.body.textContent ?? '').trim().length;
    const preLen = (pres[0].textContent ?? '').trim().length;
    return bodyLen > 0 && bodyLen === preLen;
  }

  function collectHeadings(index) {
    const out = [];

    if (isRawTextDocument()) {
      // ATX headings only ("# Title"). Setext ("Title" over "===") is deliberately
      // left out: it is rare in the technical documents this targets, and telling a
      // heading underline apart from a horizontal rule needs more context than a
      // flat scan has.
      const re = /^(#{1,6})[ \t]+(\S.*?)[ \t]*#*[ \t]*$/gm;
      let m;
      while ((m = re.exec(index.text))) {
        const title = m[2].replace(/[*_`]/g, '').trim();
        if (!title) continue;
        const start = m.index + m[1].length + 1;
        out.push({ level: m[1].length, text: title, start, end: start + m[2].length });
      }
      return out;
    }

    for (const el of document.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
      if (el.closest(`[${UI_ATTR}]`)) continue;
      const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      out.push({ level: Number(el.tagName[1]), text, el });
    }
    return out;
  }

  /* --- focus frame ------------------------------------------------------------
   * The frame CANNOT be drawn with ::highlight(): that API accepts paint properties
   * only and ignores border and outline entirely (measured — see the field notes).
   * So it is a short-lived absolutely positioned overlay built from
   * getClientRects(), removed as soon as the animation ends. Nothing is added to the
   * document permanently and the page structure is never altered.
   * -------------------------------------------------------------------------- */

  /**
   * Client rects, or an empty list — never a throw. Geometry is presentation: if it
   * is unavailable the dot or the frame is simply not drawn, and the anchoring and
   * painting pipeline above carries on untouched.
   */
  function rectsOf(target) {
    try {
      return typeof target?.getClientRects === 'function' ? [...target.getClientRects()] : [];
    } catch {
      return [];
    }
  }

  const FOCUS_ATTR = 'data-dh-focus';
  let frameTimer = null;

  function clearFocusFrames() {
    document.querySelectorAll(`[${FOCUS_ATTR}]`).forEach((n) => n.remove());
  }

  function focusFrame(rects) {
    clearFocusFrames();
    clearTimeout(frameTimer);
    if (!rects.length) return;

    const sx = window.scrollX;
    const sy = window.scrollY;
    const pad = 4;

    for (const r of rects) {
      if (!r.width && !r.height) continue;
      const box = document.createElement('div');
      box.setAttribute(UI_ATTR, '');
      box.setAttribute(FOCUS_ATTR, '');
      box.style.cssText = [
        'position:absolute',
        `top:${r.top + sy - pad}px`,
        `left:${r.left + sx - pad}px`,
        `width:${r.width + pad * 2}px`,
        `height:${r.height + pad * 2}px`,
        'border:2px solid #2563eb',
        'border-radius:4px',
        'background:rgba(37,99,235,.12)',
        'pointer-events:none',
        'z-index:2147483646',
        'opacity:0',
        'animation:dh-focus 1.6s ease-out forwards',
      ].join(';');
      document.documentElement.appendChild(box);
    }

    frameTimer = setTimeout(clearFocusFrames, 1700);
  }

  function jumpToRange(range) {
    if (!range) return;
    const first = range.getBoundingClientRect();
    window.scrollTo({
      top: Math.max(0, first.top + window.scrollY - window.innerHeight * 0.3),
      behavior: 'smooth',
    });
    // Client rects are viewport-relative, so they are re-read after the scroll
    // settles — measuring before it would frame the old position.
    setTimeout(() => focusFrame(rectsOf(range)), 400);
  }

  function jumpToElement(el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => focusFrame([el.getBoundingClientRect()]), 400);
  }

  // --- panel construction -----------------------------------------------------

  const PANEL_CSS = `
    * { box-sizing: border-box; }

    .wrap {
      position: fixed; top: 0; bottom: 0; z-index: 2147483645;
      display: flex; align-items: stretch;
      font: 13px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
      --bg:#fff; --panel:#f4f5f7; --panelHi:#e9ebef;
      --ink:#1f2937; --muted:#6b7280; --line:#dfe3e8;
    }
    .wrap[data-side="right"] { right: 0; flex-direction: row; }
    .wrap[data-side="left"]  { left: 0;  flex-direction: row-reverse; }

    .wrap[data-theme="dark"] {
      --bg:#161c24; --panel:#1f2937; --panelHi:#2a3543;
      --ink:#e8ecf1; --muted:#95a1b0; --line:#2d3947;
    }
    @media (prefers-color-scheme: dark) {
      .wrap[data-theme="auto"] {
        --bg:#161c24; --panel:#1f2937; --panelHi:#2a3543;
        --ink:#e8ecf1; --muted:#95a1b0; --line:#2d3947;
      }
    }

    /* The handle stays on screen when the panel is closed. Without it there is no
       way back in: an extension cannot add a button to the browser's own chrome.
       Which is also why it is the loudest thing here — it was drawn in the panel's
       muted chrome colours before and simply went unseen on a busy page.

       The colour is the brand yellow, the same one the highlighter paints with, on
       the same #1f2937 ink: 10.4:1, well past WCAG AAA, and it reads as "that
       highlighting tool" instead of as an anonymous tab. */
    .handle {
      align-self: center; width: ${HANDLE_W}px; height: 118px; cursor: pointer; padding: 0;
      border: 1px solid rgba(0,0,0,.18);
      background: linear-gradient(180deg, #ffd54a, #ffc933);
      color: #1f2937;
      display: grid; place-items: center;
      writing-mode: vertical-rl; font: inherit; font-size: 12px; font-weight: 700;
      letter-spacing: .08em; text-transform: uppercase;
      box-shadow: 0 0 14px rgba(255,201,51,.85), 0 0 34px rgba(255,201,51,.45),
                  0 4px 14px rgba(0,0,0,.22);
      /* Three pulses on arrival, then still. A permanent pulse next to text you are
         trying to read stops being a hint and becomes an irritation. */
      animation: dh-handle-attention 1.5s ease-out 3;
    }
    .handle:hover {
      background: linear-gradient(180deg, #ffe073, #ffd54a);
      box-shadow: 0 0 20px rgba(255,201,51,1), 0 0 48px rgba(255,201,51,.6),
                  0 4px 18px rgba(0,0,0,.26);
    }
    .handle:active { transform: scale(.97); }
    .handle:focus-visible { outline: 3px solid #2563eb; outline-offset: 2px; }

    @keyframes dh-handle-attention {
      0%, 100% { box-shadow: 0 0 14px rgba(255,201,51,.85), 0 0 34px rgba(255,201,51,.45),
                             0 4px 14px rgba(0,0,0,.22); }
      50%      { box-shadow: 0 0 26px rgba(255,201,51,1), 0 0 62px rgba(255,201,51,.75),
                             0 4px 14px rgba(0,0,0,.22); }
    }

    /* Anyone who has asked the system to calm animations down gets the glow
       without the pulse. */
    @media (prefers-reduced-motion: reduce) {
      .handle { animation: none; }
    }
    .wrap[data-side="right"] .handle { border-radius: 8px 0 0 8px; border-right: 0; }
    .wrap[data-side="left"]  .handle { border-radius: 0 8px 8px 0; border-left: 0; transform: rotate(180deg); }

    .body {
      width: ${PANEL_W}px; display: flex; flex-direction: column;
      background: var(--bg); color: var(--ink);
      border-left: 1px solid var(--line); border-right: 1px solid var(--line);
      box-shadow: 0 0 24px rgba(0,0,0,.14);
    }
    .wrap:not([data-open]) .body { display: none; }

    header { display: flex; align-items: center; gap: 6px; padding: 10px 10px 8px; }
    header .name { font-weight: 650; font-size: 12px; letter-spacing: -.01em; flex: 1;
                   overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .icobtn {
      width: 24px; height: 24px; border-radius: 6px; cursor: pointer; padding: 0;
      border: 1px solid var(--line); background: transparent; color: var(--muted);
      display: grid; place-items: center; font: inherit; font-size: 13px; line-height: 1;
    }
    .icobtn:hover { color: var(--ink); background: var(--panelHi); }

    .tabs { display: flex; gap: 4px; padding: 0 10px 8px; }
    .tab {
      flex: 1; padding: 5px 8px; border-radius: 6px; cursor: pointer; font: inherit;
      font-size: 12px; border: 1px solid transparent; background: transparent; color: var(--muted);
    }
    .tab[aria-selected="true"] {
      background: var(--panel); border-color: var(--line); color: var(--ink); font-weight: 600;
    }

    .list { flex: 1; overflow-y: auto; padding: 2px 6px 12px; }
    .row {
      display: flex; gap: 7px; align-items: flex-start; width: 100%;
      padding: 5px 7px; border: 0; border-radius: 6px; cursor: pointer;
      background: transparent; color: inherit; text-align: left;
      font: inherit; line-height: 1.35;
    }
    .row:hover { background: var(--panelHi); }
    .row[disabled] { cursor: default; opacity: .45; }
    .row[disabled]:hover { background: transparent; }
    .row .t { flex: 1; overflow-wrap: anywhere; }

    .lvl1 { font-weight: 650; }
    .lvl2 { padding-left: 14px; }
    .lvl3 { padding-left: 26px; color: var(--muted); }
    .lvl4, .lvl5, .lvl6 { padding-left: 38px; color: var(--muted); font-size: 12px; }

    .chip { width: 11px; height: 11px; border-radius: 3px; margin-top: 3px; flex: none;
            border: 1px solid rgba(0,0,0,.18); }
    .chip.u { background: repeating-linear-gradient(180deg, transparent 0 7px, #e11d48 7px 9px); }

    .note {
      display: block; margin-top: 3px; padding-left: 6px;
      border-left: 2px solid #d97706; color: var(--muted); font-size: 12px;
      overflow-wrap: anywhere;
    }
    .note.from-tr { border-left-color: #2563eb; }

    .when {
      display: block; margin-top: 3px; color: var(--muted);
      font-size: 10px; letter-spacing: .02em; font-variant-numeric: tabular-nums;
    }
    .note-chip { border-color: transparent; }
    .note-chip.from-me { background: #d97706; border-radius: 3px 3px 3px 1px; }
    .note-chip.from-tr { background: #2563eb; border-radius: 50%; }
    .note-lead { display: block; }
    .note-quote {
      display: block; margin-top: 3px; padding-left: 6px;
      border-left: 2px solid var(--line); color: var(--muted); font-size: 11px;
    }

    .empty { padding: 16px 10px; color: var(--muted); font-size: 12px; }
  `;

  /* --- page theme and layout --------------------------------------------------
   * The panel lives in a shadow root, so nothing it does reaches the page. Both
   * repainting the document and making room for the panel therefore need real
   * stylesheets injected into the page.
   *
   * LAYOUT — the panel is position:fixed, so without this it would sit ON TOP of
   * the text. Giving <html> a margin on the docked side shrinks the document box
   * while the fixed panel stays at the viewport edge: the two stop overlapping.
   * The handle's own width is reserved even when the panel is closed, so the text
   * is never covered at all.
   *
   * THEME — scoped deliberately to html/body and the elements Chrome's plain-text
   * and simple-document rendering actually produces. Deep per-component theming is
   * NOT attempted: that is a whole product of its own (Dark Reader), it needs
   * per-site work, and a half-done version looks worse than none. On a raw .md
   * file — what this extension is for — these few rules ARE the whole document.
   *
   * Highlight colours are unaffected either way: ::highlight() paints its own
   * background and its own ink, so a yellow mark stays readable on a dark page.
   * ------------------------------------------------------------------------- */

  const THEME_ID = 'dh-page-theme';
  const LAYOUT_ID = 'dh-page-layout';

  const PAGE_THEME = {
    dark: `
      html, body { background: #161c24 !important; color: #e8ecf1 !important; }
      pre, code, kbd, samp, blockquote, table { background: #1f2937 !important; color: #e8ecf1 !important; }
      a, a * { color: #7fb0ff !important; }
      hr, th, td { border-color: #2d3947 !important; }
      ::selection { background: #33507a; color: #fff; }
    `,
    light: `
      html, body { background: #ffffff !important; color: #1f2937 !important; }
      pre, code, kbd, samp, blockquote, table { background: #f4f5f7 !important; color: #1f2937 !important; }
      a, a * { color: #b45309 !important; }
      hr, th, td { border-color: #dfe3e8 !important; }
    `,
  };

  /** Injects, updates or removes a page-level stylesheet owned by the extension. */
  function pageStyle(id, css) {
    const existing = document.getElementById(id);
    if (!css) {
      existing?.remove();
      return;
    }
    const el = existing ?? document.createElement('style');
    el.id = id;
    el.setAttribute(UI_ATTR, '');
    el.textContent = css;
    if (!existing) document.head?.appendChild(el) ?? document.documentElement.appendChild(el);
  }

  function applyPageChrome() {
    if (!isTopFrame) return;

    // 'auto' means "do not touch the page": the document keeps whatever the site
    // or Chrome gave it. Only an explicit light/dark choice repaints.
    pageStyle(THEME_ID, PAGE_THEME[prefs.theme]);

    const reserved = prefs.open ? PANEL_W + HANDLE_W : HANDLE_W;
    pageStyle(
      LAYOUT_ID,
      `html { margin-${prefs.side}: ${reserved}px !important; transition: margin .18s ease; }`,
    );
  }

  function buildPanel() {
    pHost = document.createElement('div');
    pHost.setAttribute(UI_ATTR, '');
    pShadow = pHost.attachShadow({ mode: 'closed' });
    pShadow.innerHTML =
      `<style>${PANEL_CSS}</style>` +
      `<div class="wrap">` +
      `<button class="handle" data-act="toggle"></button>` +
      `<div class="body">` +
      `<header>` +
      `<span class="name">${msg('pnlTitle', 'Doc Highlighter')}</span>` +
      `<button class="icobtn" data-act="preview" title="${msg('pnlPreview', 'Rendered / source')}">&#9776;</button>` +
      `<button class="icobtn" data-act="side" title="${msg('pnlSide', 'Move to the other side')}">&#8646;</button>` +
      `<button class="icobtn" data-act="theme" title="${msg('pnlTheme', 'Light / dark')}">&#9680;</button>` +
      `<button class="icobtn" data-act="toggle" title="${msg('pnlClose', 'Close')}">&times;</button>` +
      `</header>` +
      `<div class="tabs">` +
      `<button class="tab" data-tab="toc">${msg('pnlContents', 'Contents')}</button>` +
      `<button class="tab" data-tab="marks">${msg('pnlHighlights', 'Highlights')}</button>` +
      `<button class="tab" data-tab="notes">${msg('pnlNotes', 'Notes')}</button>` +
      `</div>` +
      `<div class="list"></div>` +
      `</div></div>`;

    document.documentElement.appendChild(pHost);
    pShadow.addEventListener('click', onPanelClick);
    syncPanelChrome();
  }

  /** Side, theme, open state, handle label, tab selection — everything but the lists. */
  function syncPanelChrome() {
    applyPageChrome();
    if (!pShadow) return;
    const wrap = pShadow.querySelector('.wrap');
    wrap.dataset.side = prefs.side;
    wrap.dataset.theme = prefs.theme;
    if (prefs.open) wrap.setAttribute('data-open', '');
    else wrap.removeAttribute('data-open');

    pShadow.querySelector('.handle').textContent = prefs.open
      ? msg('pnlClose', 'Close')
      : msg('pnlOpen', 'Contents');

    for (const t of pShadow.querySelectorAll('.tab')) {
      t.setAttribute('aria-selected', String(t.dataset.tab === pTab));
    }
  }

  /**
   * Short, and relative where that reads better: something marked an hour ago is
   * "14:32", something from last month is a date. The exact timestamp lives on the
   * title attribute for anyone who needs it.
   */
  function stamp(ts) {
    if (!ts) return null;
    const d = new Date(ts);
    const sameDay = d.toDateString() === new Date().toDateString();
    const lang = chrome.i18n.getUILanguage?.() || undefined;
    const el = document.createElement('span');
    el.className = 'when';
    el.textContent = sameDay
      ? d.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString(lang, { day: '2-digit', month: 'short' });
    el.title = d.toLocaleString(lang);
    return el;
  }

  /** The palette can change before the panel exists; that is not a failure. */
  const renderPanelSafe = () => {
    try {
      renderPanel();
    } catch {
      /* panel not built yet */
    }
  };
  function renderPanel() {
    if (!pShadow || !prefs.open) return;
    const list = pShadow.querySelector('.list');
    list.textContent = '';

    const rows = pTab === 'toc' ? tocRows() : pTab === 'notes' ? noteRows() : markRows();
    if (!rows.length) {
      const p = document.createElement('div');
      p.className = 'empty';
      p.textContent =
        pTab === 'toc'
          ? msg('pnlNoHeadings', 'No headings found in this document.')
          : pTab === 'notes'
            ? msg('pnlNoNotes', 'No notes on this page yet.')
            : msg('pnlNoMarks', 'Nothing highlighted on this page yet.');
      list.appendChild(p);
      return;
    }
    for (const r of rows) list.appendChild(r);
  }

  function tocRows() {
    return tocItems.map((h, i) => {
      const b = document.createElement('button');
      b.className = `row lvl${h.level}`;
      b.dataset.toc = String(i);
      const t = document.createElement('span');
      t.className = 't';
      t.textContent = h.text;
      b.appendChild(t);
      return b;
    });
  }

  /**
   * Notes get a tab of their own because a note is something you go looking for by
   * its OWN content — "where did I write about the toggle?" — and hunting for that
   * inside a list of every mark on the page is the wrong shape for the question.
   */
  function noteRows() {
    return state.highlights
      .filter((h) => h.note)
      .map((h) => ({ h, l: live.get(h.id) }))
      .sort((a, b) => (a.l?.start ?? Infinity) - (b.l?.start ?? Infinity))
      .map(({ h, l }) => {
        const b = document.createElement('button');
        b.className = 'row';
        b.dataset.mark = h.id;
        if (!l) {
          b.disabled = true;
          b.title = msg('pnlOrphan', 'This text is not on the page right now.');
        }

        const chip = document.createElement('span');
        chip.className = h.color
          ? 'chip'
          : `chip note-chip ${h.noteFrom === 'translate' ? 'from-tr' : 'from-me'}`;
        if (h.color) chip.style.background = PALETTE[h.color] ?? PALETTE.yellow;
        chip.title = h.noteFrom === 'translate' ? msg('noteFromTranslate', 'Translation') : msg('noteFromMe', 'Your note');
        b.appendChild(chip);

        const t = document.createElement('span');
        t.className = 't';

        // The note leads and the passage follows in smaller type: in THIS tab the
        // note is the content and the quote is the context. The Highlights tab has
        // it the other way round, which is why both tabs earn their place.
        const lead = document.createElement('span');
        lead.className = 'note-lead';
        lead.textContent = h.note.replace(/\s+/g, ' ').trim();
        t.appendChild(lead);

        const raw = (h.anchor?.exact ?? '').replace(/\s+/g, ' ').trim();
        if (raw) {
          const q = document.createElement('span');
          q.className = 'note-quote';
          q.textContent = raw.length > 70 ? `${raw.slice(0, 70)}…` : raw;
          const whenNote = stamp(h.createdAt);
          if (whenNote) t.appendChild(whenNote);
          t.appendChild(q);
        }

        b.appendChild(t);
        return b;
      });
  }

  function markRows() {
    // Document order, not creation order: the panel is a map of the page, and a map
    // that lists things in the order they were made is not a map.
    const items = state.highlights
      .map((h) => ({ h, l: live.get(h.id) }))
      .sort((a, b) => (a.l?.start ?? Infinity) - (b.l?.start ?? Infinity));

    return items.map(({ h, l }) => {
      const b = document.createElement('button');
      b.className = 'row';
      b.dataset.mark = h.id;
      // An orphan is not deleted, it simply cannot be jumped to on this page.
      if (!l) {
        b.disabled = true;
        b.title = msg('pnlOrphan', 'This text is not on the page right now.');
      }

      const chip = document.createElement('span');
      chip.className = h.color ? 'chip' : 'chip u';
      if (h.color) chip.style.background = PALETTE[h.color] ?? '#ffd54a';
      b.appendChild(chip);

      const t = document.createElement('span');
      t.className = 't';
      const raw = (h.anchor?.exact ?? '').replace(/\s+/g, ' ').trim();
      t.textContent = raw.length > 90 ? `${raw.slice(0, 90)}…` : raw;

      // The note lives on the same row rather than in a tab of its own: it belongs
      // to this mark, and splitting it out would make the reader hold two lists in
      // their head to answer one question.
      if (h.note) {
        const n = document.createElement('span');
        n.className = `note ${h.noteFrom === 'translate' ? 'from-tr' : 'from-me'}`;
        n.textContent = h.note.replace(/\s+/g, ' ').trim();
        t.appendChild(n);
      }

      // Outside the branch above: every mark has a creation time, not only the ones
      // carrying a note.
      const whenMark = stamp(h.createdAt);
      if (whenMark) t.appendChild(whenMark);

      b.appendChild(t);
      return b;
    });
  }

  async function onPanelClick(e) {
    const btn = e.target.closest?.('button');
    if (!btn) return;

    if (btn.dataset.act === 'toggle') {
      prefs.open = !prefs.open;
      syncPanelChrome();
      renderPanel();
      return savePrefs();
    }
    if (btn.dataset.act === 'preview') {
      setPreview(!prefs.preview);
      return;
    }
    if (btn.dataset.act === 'side') {
      prefs.side = prefs.side === 'right' ? 'left' : 'right';
      syncPanelChrome();
      return savePrefs();
    }
    if (btn.dataset.act === 'theme') {
      prefs.theme = prefs.theme === 'auto' ? 'light' : prefs.theme === 'light' ? 'dark' : 'auto';
      syncPanelChrome();
      return savePrefs();
    }
    if (btn.dataset.tab) {
      pTab = btn.dataset.tab;
      syncPanelChrome();
      return renderPanel();
    }
    if (btn.dataset.toc !== undefined) {
      const h = tocItems[Number(btn.dataset.toc)];
      if (!h) return;
      if (h.el) return jumpToElement(h.el);
      // Raw text document: the heading is an offset range, not an element. The index
      // is rebuilt because the document may have changed since the panel was filled.
      return jumpToRange(offsetsToRange(buildIndex(), h.start, h.end));
    }
    if (btn.dataset.mark) {
      const l = live.get(btn.dataset.mark);
      if (l) jumpToRange(l.range);
      // Opened after the scroll settles, so the card is placed against where the
      // passage ENDS UP rather than where it started.
      if (pTab === 'notes') setTimeout(() => openNoteCard(btn.dataset.mark), 450);
    }
  }

  /** Called after every re-anchor, so both lists keep following the document. */
  function refreshPanel(index) {
    if (!isTopFrame || !pShadow) return;
    tocItems = collectHeadings(index);
    renderPanel();
  }

  // --- 8. sticky notes -------------------------------------------------------
  // A note belongs to a highlight rather than being its own object: the anchoring
  // system already exists, is tested, and relocates text when the document changes.
  // A second anchor system for standalone notes would buy nothing.
  //
  // Nothing is inserted into the text. ::highlight() cannot render an indicator and
  // the engine never mutates page structure, so the dot and the card are absolutely
  // positioned overlays in ONE shadow layer — page CSS cannot reach them, and a
  // single host serves any number of notes.

  const NOTE_LAYER_Z = 2147483644;

  let nHost = null;
  let nShadow = null;
  let noteOpenId = null; // the highlight whose card is open, if it already exists
  let notePendingRange = null; // a selection with no mark yet — created on save

  const NOTE_CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }

    /* No border and no shadow: on a dark page a white ring around the dot reads as
       a frame stuck onto the text rather than as part of the mark. State is shown
       by colour and size instead of by an outline. */
    .dot {
      position: absolute; width: 12px; height: 12px; padding: 0; border: 0;
      cursor: pointer; pointer-events: auto;
    }
    /* Written by the reader: the folded corner of a sticky note, in amber. */
    .dot.from-me { background: #d97706; border-radius: 50% 50% 50% 2px; }
    .dot.from-me:hover, .dot.from-me[aria-expanded="true"] { background: #b45309; }
    /* Produced by the translator: round, blue, no corner to fold. */
    .dot.from-tr { background: #2563eb; border-radius: 50%; }
    .dot.from-tr:hover, .dot.from-tr[aria-expanded="true"] { background: #1d4ed8; }
    .dot:hover, .dot[aria-expanded="true"] { transform: scale(1.2); }
    /* Keyboard users still need to see where they are; this is the one case where
       a ring is the point rather than clutter. */
    .dot:focus-visible { outline: 2px solid #2563eb; outline-offset: 2px; }

    .card {
      position: absolute; width: 268px; pointer-events: auto;
      background: var(--bg); color: var(--ink);
      border: 1px solid var(--line); border-radius: 10px;
      box-shadow: 0 10px 30px rgba(0,0,0,.22);
      font: 13px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
      padding: 9px;
      --bg:#fffdf3; --ink:#1f2937; --muted:#6b7280; --line:#e6dfc4;
    }
    .card[data-theme="dark"] { --bg:#1f2937; --ink:#e8ecf1; --muted:#95a1b0; --line:#2d3947; }

    textarea {
      width: 100%; min-height: 84px; resize: vertical; display: block;
      border: 1px solid var(--line); border-radius: 6px; padding: 6px 7px;
      background: transparent; color: var(--ink);
      font: inherit; line-height: 1.45; outline: none;
    }
    textarea:focus { border-color: #2563eb; }

    .quote {
      color: var(--muted); font-size: 11px; margin: 0 0 6px; line-height: 1.4;
      max-height: 32px; overflow: hidden; border-left: 2px solid var(--line); padding-left: 6px;
    }
    .tr-out { font-size: 13px; line-height: 1.5; max-height: 190px; overflow-y: auto;
              border-left: 2px solid #2563eb; padding-left: 8px; }
    .tr-why { font: 11px/1.45 ui-monospace, Consolas, monospace; color: var(--muted);
              margin-top: 6px; overflow-wrap: anywhere; }
    .actions { display: flex; gap: 6px; margin-top: 7px; }
    .actions button {
      border-radius: 6px; cursor: pointer; font: inherit; font-size: 12px;
      padding: 4px 9px; border: 1px solid var(--line); background: transparent; color: var(--ink);
    }
    .actions .primary { background: #2563eb; border-color: #2563eb; color: #fff; font-weight: 600; }
    .actions .danger { color: #c5221f; margin-left: auto; }
    .actions button:hover { filter: brightness(.95); }
  `;

  function buildNoteLayer() {
    nHost = document.createElement('div');
    nHost.setAttribute(UI_ATTR, '');
    // Zero-sized, non-interactive host anchored at the document origin: children
    // position themselves in DOCUMENT coordinates, so scrolling never moves them
    // and no repositioning work is needed on scroll.
    nHost.style.cssText =
      `position:absolute;top:0;left:0;width:0;height:0;pointer-events:none;z-index:${NOTE_LAYER_Z}`;
    nShadow = nHost.attachShadow({ mode: 'closed' });
    nShadow.innerHTML = `<style>${NOTE_CSS}</style>`;
    document.documentElement.appendChild(nHost);
    nShadow.addEventListener('click', onNoteLayerClick);
  }

  /**
   * Dots for every note whose text is currently on the page. Called from applyAll,
   * so they follow re-anchoring, resize and DOM mutation without their own watcher.
   * Only highlights that HAVE a note get a dot — a marker on every highlight would
   * be noise, not information.
   */
  function renderNoteDots() {
    try {
      renderNoteDotsUnsafe();
    } catch (e) {
      // Logged, NOT swallowed silently: an empty catch here would hide a real
      // regression behind "the dots just stopped appearing one day".
      log(`${TAG} not gostergeleri cizilemedi`, e);
    }
  }

  function renderNoteDotsUnsafe() {
    if (!nShadow) return;
    for (const d of nShadow.querySelectorAll('.dot')) d.remove();

    const sx = window.scrollX;
    const sy = window.scrollY;

    for (const h of state.highlights) {
      if (!h.note) continue;
      const l = live.get(h.id);
      if (!l) continue; // orphan: the text is not on this page right now

      const rects = rectsOf(l.range);
      const last = rects[rects.length - 1];
      if (!last) continue;

      const dot = document.createElement('button');
      // Two cues, not one: a translation is a blue circle, a note you wrote is an
      // amber square with a folded corner. Colour alone would be a cool-vs-cool pair,
      // which is the first thing colour vision deficiency takes away.
      const kind = h.noteFrom === 'translate' ? 'from-tr' : 'from-me';
      dot.className = `dot ${kind}`;
      dot.dataset.note = h.id;
      const lead = h.noteFrom === 'translate' ? `${msg('noteFromTranslate', 'Translation')} — ` : '';
      dot.title = lead + (h.note.length > 60 ? `${h.note.slice(0, 60)}…` : h.note);
      dot.setAttribute('aria-expanded', String(noteOpenId === h.id));
      // Sits just past the END of the highlight. When a highlight wraps, the last
      // rect is the last visual line, which is where a reader's eye ends up.
      dot.style.left = `${last.right + sx + 2}px`;
      dot.style.top = `${last.top + sy - 3}px`;
      nShadow.appendChild(dot);
    }
  }

  function closeNoteCard() {
    nShadow?.querySelector('.card')?.remove();
    noteOpenId = null;
    notePendingRange = null;
    renderNoteDots();
  }

  /**
   * Opens the editor for an existing mark, or for a selection that has none yet.
   * Nothing is written until save, so backing out leaves the document untouched.
   */
  function openNoteCard(id, pendingRange) {
    if (!nShadow) return;
    const h = id ? byId(id) : null;
    if (!h && !pendingRange) return;

    notePendingRange = h ? null : pendingRange;
    const l = id ? live.get(id) : null;

    nShadow.querySelector('.card')?.remove();
    noteOpenId = id;

    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.theme = prefs.theme === 'dark' ? 'dark' : 'light';

    const quote = document.createElement('p');
    quote.className = 'quote';
    const raw = (h?.anchor?.exact ?? pendingRange?.toString() ?? '').replace(/\s+/g, ' ').trim();
    quote.textContent = raw.length > 120 ? `${raw.slice(0, 120)}…` : raw;

    const ta = document.createElement('textarea');
    ta.value = h?.note ?? '';
    ta.placeholder = msg('notePlaceholder', 'Write a note…');

    const actions = document.createElement('div');
    actions.className = 'actions';
    actions.innerHTML =
      `<button class="primary" data-note-act="save">${msg('noteSave', 'Save')}</button>` +
      `<button data-note-act="cancel">${msg('noteCancel', 'Cancel')}</button>` +
      `<button class="danger" data-note-act="delete">${msg('noteDelete', 'Delete')}</button>`;

    card.append(quote, ta, actions);

    // Positioned below the end of the passage, clamped so it never hangs off the
    // right edge of the document.
    const rects = l ? rectsOf(l.range) : rectsOf(pendingRange);
    const last = rects[rects.length - 1];
    const left = last ? last.right + window.scrollX - 120 : window.scrollX + 40;
    const top = last ? last.bottom + window.scrollY + 10 : window.scrollY + 60;
    card.style.left = `${Math.max(8, Math.min(left, window.scrollX + window.innerWidth - 288))}px`;
    card.style.top = `${top}px`;

    nShadow.appendChild(card);
    renderNoteDots();
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }

  async function onNoteLayerClick(e) {
    const dot = e.target.closest?.('.dot');
    if (dot) {
      const id = dot.dataset.note;
      return noteOpenId === id ? closeNoteCard() : openNoteCard(id);
    }

    const btn = e.target.closest?.('[data-note-act]');
    if (!btn) return;
    const act = btn.dataset.noteAct;
    const id = noteOpenId;
    const pending = notePendingRange;
    if (!id && !pending) return;

    // Cancel and delete are the same thing when nothing exists yet: there is
    // nothing to undo, because nothing was written.
    if (act === 'cancel') return closeNoteCard();

    if (act === 'delete') {
      closeNoteCard();
      // Removing the note does NOT remove the mark — unless the note was the only
      // thing keeping it alive, which patchHighlight decides.
      return id ? patchHighlight(id, { note: '' }) : undefined;
    }

    if (act === 'save') {
      const text = nShadow.querySelector('textarea')?.value.trim() ?? '';
      // The translate card and the note card share this handler; only the card knows
      // which one the reader was looking at.
      const from = nShadow.querySelector('.card')?.dataset.role === 'translate' ? 'translate' : undefined;
      closeNoteCard();
      if (!text) return id ? patchHighlight(id, { note: '' }) : undefined;
      // The mark is born here, carrying the note, so an abandoned card never leaves
      // an invisible record behind.
      return id
        ? patchHighlight(id, { note: text, noteFrom: from })
        : applyToSelection(pending, { note: text, noteFrom: from });
    }
  }

  /** Entry point from the selection toolbar. */
  function addNoteFromToolbar() {
    if (hoveredId) return openNoteCard(hoveredId);
    if (pendingRange) openNoteCard(null, pendingRange);
  }


  // --- 9. markdown preview ---------------------------------------------------
  // Chrome shows a local .md file as plain text in a single <pre>. This renders it.
  //
  // THIS IS THE ONE PLACE THE ENGINE DELIBERATELY REWRITES THE DOCUMENT, and it is
  // worth being explicit about why that is not a contradiction. The "never touch the
  // DOM" rule exists to stop INCIDENTAL mutation from breaking anchors — wrapping
  // text in <mark>, colliding with SPA re-renders. Switching view is not incidental:
  // it is the user asking for a different document, once, on purpose.
  //
  // What it costs: anchors are offsets and quotes into the flattened text, and
  // rendering CHANGES that text — "## Title" becomes "Title", backticks disappear.
  // A mark that covered markdown syntax will not resolve in the rendered view. It is
  // NOT lost: orphans are kept, and come back when the view is switched off. That is
  // the same mechanism that already handles an edited document, reused rather than
  // rebuilt.
  //
  // No third-party renderer: remote code is neither allowed by the CSP nor by what
  // was declared to the store, and bundling one would double the package for the
  // long tail of Markdown that technical documents rarely use.

  const MD_URL = /\.(md|markdown|mdown|mkd|mdx)$/i;
  const RENDER_ATTR = 'data-dh-rendered';

  let rawPre = null; // the original <pre>, kept so the raw view can come back

  /** Preview is only offered where there is something to preview. */
  function canPreview() {
    return isTopFrame && MD_URL.test(location.pathname) && (!!rawPre || isRawTextDocument());
  }

  const escapeHtml = (t) =>
    t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  /**
   * Only these schemes survive. A .md file is untrusted input — it can come from a
   * repository, a download, anywhere — and "javascript:" in a link would run in the
   * page the moment it is clicked.
   */
  const safeUrl = (u) => {
    const t = u.trim();
    return /^(https?:|mailto:|#|\/|\.{0,2}\/)/i.test(t) || !/^[a-z][a-z0-9+.-]*:/i.test(t) ? t : '#';
  };

  /** Inline spans. HTML is escaped FIRST, so raw markup in the file never renders. */
  function mdInline(text) {
    let s = escapeHtml(text);

    // Code spans first: nothing inside them should be interpreted further.
    const codes = [];
    s = s.replace(/`([^`]+)`/g, (_, c) => ` ${codes.push(c) - 1} `);

    s = s
      .replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (_, a, h) => `<img alt="${a}" src="${safeUrl(h)}">`)
      .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (_, t, h) => `<a href="${safeUrl(h)}">${t}</a>`)
      .replace(/(^|[^\w*])\*\*([^*]+)\*\*/g, '$1<strong>$2</strong>')
      .replace(/(^|[^\w*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/(^|[^\w_])__([^_]+)__/g, '$1<strong>$2</strong>')
      .replace(/~~([^~]+)~~/g, '<del>$1</del>');

    return s.replace(/ (\d+) /g, (_, i) => `<code>${codes[Number(i)]}</code>`);
  }

  /**
   * Block parser. Line based on purpose: a full Markdown implementation is a large
   * dependency and this targets technical documentation — headings, code, lists,
   * tables, quotes. Anything unrecognised falls through as a paragraph, which is
   * the failure mode that loses the least.
   */
  function renderMarkdown(src) {
    const lines = src.split('\n');
    const out = [];
    let i = 0;

    const isBlank = (l) => !l.trim();

    while (i < lines.length) {
      const line = lines[i];

      if (isBlank(line)) {
        i++;
        continue;
      }

      // fenced code
      const fence = line.match(/^\s*(```+|~~~+)\s*(\S*)/);
      if (fence) {
        const close = fence[1][0];
        const lang = fence[2];
        const body = [];
        i++;
        while (i < lines.length && !new RegExp(`^\\s*${close}{3,}\\s*$`).test(lines[i])) {
          body.push(lines[i]);
          i++;
        }
        i++; // closing fence
        out.push(
          `<pre class="dh-code"${lang ? ` data-lang="${escapeHtml(lang)}"` : ''}>` +
            `<code>${escapeHtml(body.join('\n'))}</code></pre>`,
        );
        continue;
      }

      // heading
      const h = line.match(/^(#{1,6})[ \t]+(.+?)[ \t]*#*\s*$/);
      if (h) {
        const lvl = h[1].length;
        out.push(`<h${lvl}>${mdInline(h[2])}</h${lvl}>`);
        i++;
        continue;
      }

      // horizontal rule
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
        out.push('<hr>');
        i++;
        continue;
      }

      // table: a header row followed by a separator row
      if (line.includes('|') && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1] ?? '')) {
        const cells = (l) =>
          l.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
        const head = cells(line);
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].includes('|') && !isBlank(lines[i])) {
          rows.push(cells(lines[i]));
          i++;
        }
        out.push(
          '<table><thead><tr>' +
            head.map((c) => `<th>${mdInline(c)}</th>`).join('') +
            '</tr></thead><tbody>' +
            rows
              .map((r) => `<tr>${r.map((c) => `<td>${mdInline(c)}</td>`).join('')}</tr>`)
              .join('') +
            '</tbody></table>',
        );
        continue;
      }

      // blockquote
      if (/^\s*>/.test(line)) {
        const body = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) {
          body.push(lines[i].replace(/^\s*>\s?/, ''));
          i++;
        }
        out.push(`<blockquote>${renderMarkdown(body.join('\n'))}</blockquote>`);
        continue;
      }

      // list — one level of nesting, which is as far as technical docs usually go
      const li = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
      if (li) {
        const ordered = /\d/.test(li[2]);
        const items = [];
        while (i < lines.length) {
          const m = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
          if (!m) {
            // a continuation line belongs to the item above it
            if (!isBlank(lines[i]) && items.length && /^\s{2,}/.test(lines[i])) {
              items[items.length - 1] += ` ${lines[i].trim()}`;
              i++;
              continue;
            }
            break;
          }
          const indented = m[1].length >= 2;
          if (indented && items.length) {
            items[items.length - 1] += `${m[3]}`; // nested, joined below
          } else {
            items.push(m[3]);
          }
          i++;
        }
        const render = (t) => {
          const [own, ...kids] = t.split('');
          const nested = kids.length
            ? `<ul>${kids.map((k) => `<li>${mdInline(k)}</li>`).join('')}</ul>`
            : '';
          return `<li>${mdInline(own)}${nested}</li>`;
        };
        out.push(
          ordered
            ? `<ol>${items.map(render).join('')}</ol>`
            : `<ul>${items.map(render).join('')}</ul>`,
        );
        continue;
      }

      // paragraph
      const para = [];
      while (i < lines.length && !isBlank(lines[i]) && !/^\s*(#{1,6}\s|>|```|~~~)/.test(lines[i])) {
        para.push(lines[i]);
        i++;
      }
      if (para.length) out.push(`<p>${mdInline(para.join('\n'))}</p>`);
      else i++;
    }

    return out.join('\n');
  }

  const PREVIEW_CSS = `
    [${RENDER_ATTR}] {
      max-width: 46rem; margin: 0 auto; padding: 2.5rem 1.5rem 5rem;
      font: 16px/1.7 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      overflow-wrap: break-word;
    }
    [${RENDER_ATTR}] h1 { font-size: 2rem; line-height: 1.25; margin: 2rem 0 .75rem; }
    [${RENDER_ATTR}] h2 { font-size: 1.5rem; line-height: 1.3; margin: 2rem 0 .6rem;
                          padding-bottom: .3rem; border-bottom: 1px solid rgba(128,128,128,.28); }
    [${RENDER_ATTR}] h3 { font-size: 1.2rem; margin: 1.6rem 0 .5rem; }
    [${RENDER_ATTR}] h4, [${RENDER_ATTR}] h5, [${RENDER_ATTR}] h6 { font-size: 1rem; margin: 1.3rem 0 .4rem; }
    [${RENDER_ATTR}] p { margin: 0 0 1rem; }
    [${RENDER_ATTR}] ul, [${RENDER_ATTR}] ol { margin: 0 0 1rem; padding-left: 1.5rem; }
    [${RENDER_ATTR}] li { margin: .3rem 0; }
    [${RENDER_ATTR}] blockquote {
      margin: 0 0 1rem; padding: .1rem 1rem; border-left: 3px solid rgba(128,128,128,.45);
      opacity: .88;
    }
    [${RENDER_ATTR}] code {
      font: .88em/1.5 ui-monospace, Consolas, monospace;
      background: rgba(128,128,128,.16); border-radius: 4px; padding: .12em .38em;
    }
    [${RENDER_ATTR}] pre.dh-code {
      background: rgba(128,128,128,.14); border-radius: 8px; padding: .9rem 1rem;
      overflow-x: auto; margin: 0 0 1rem;
    }
    [${RENDER_ATTR}] pre.dh-code code { background: none; padding: 0; font-size: .86em; }
    [${RENDER_ATTR}] table { border-collapse: collapse; width: 100%; margin: 0 0 1rem; font-size: .95em; }
    [${RENDER_ATTR}] th, [${RENDER_ATTR}] td {
      border: 1px solid rgba(128,128,128,.35); padding: .45rem .6rem; text-align: left; vertical-align: top;
    }
    [${RENDER_ATTR}] th { background: rgba(128,128,128,.12); }
    [${RENDER_ATTR}] hr { border: 0; border-top: 1px solid rgba(128,128,128,.35); margin: 2rem 0; }
    [${RENDER_ATTR}] img { max-width: 100%; height: auto; }
    [${RENDER_ATTR}] a { color: #2563eb; }
  `;

  /**
   * Switches between raw and rendered. Re-anchoring afterwards is what makes marks
   * survive the switch: applyAll rebuilds the index against the NEW text and finds
   * each passage again by its quote.
   */
  function applyPreviewDom(on) {
    if (!isTopFrame) return;

    if (on) {
      const pre = rawPre ?? document.body?.querySelector('pre');
      if (!pre) return;
      rawPre = pre;
      if (document.querySelector(`[${RENDER_ATTR}]`)) return;

      pageStyle('dh-preview-style', PREVIEW_CSS);
      const host = document.createElement('div');
      host.setAttribute(RENDER_ATTR, '');
      // Deliberately NOT marked as our UI: this IS the document now, and it must be
      // indexed so highlighting works on the rendered text.
      host.innerHTML = renderMarkdown(pre.textContent ?? '');
      // replaceWith, NOT display:none. buildIndex walks text nodes and does not
      // consult computed style, so a hidden source would still put every character
      // of the document into the index a second time, and an anchor could land on
      // text nobody can see. The node is kept detached, which is also what makes
      // going back a single call.
      pre.replaceWith(host);
    } else {
      const host = document.querySelector(`[${RENDER_ATTR}]`);
      if (host && rawPre) host.replaceWith(rawPre);
      else host?.remove();
      pageStyle('dh-preview-style', null);
    }

  }

  /**
   * Split from applyPreviewDom so startup can render BEFORE the first anchoring
   * pass. Rendering after it would resolve every mark against the raw text and
   * then immediately throw that work away.
   */
  function setPreview(on) {
    applyPreviewDom(on);
    prefs.preview = on;
    savePrefs();
    syncPanelChrome();
    applyAll(buildIndex()); // re-anchor against the view that is now on screen
  }

  // --- 10. translate ---------------------------------------------------------
  // Chrome's built-in Translator runs the model ON THE DEVICE. That is the only
  // reason this feature exists at all: sending a passage to a translation service
  // would break the one promise this extension is built on, and would contradict
  // both the privacy policy and what was declared to the store.
  //
  // One thing to be precise about, because it is easy to overstate: Chrome
  // downloads a language model the first time a pair is used. That download is
  // Chrome's, and it carries no page text — but it IS a network fetch, so the
  // privacy policy says so plainly rather than claiming nothing ever happens.
  //
  // Requires Chrome 138+ on desktop. Everywhere else the feature reports itself as
  // unavailable instead of failing when pressed.

  const TR_KEY = 'dhTranslate';
  const trPrefs = { enabled: false, target: 'en' };

  // Codes only — the NAMES come from Intl.DisplayNames, so no list of language
  // names is kept (or translated, or allowed to drift) anywhere in this project.
  const QUICK_LANGS = ['en', 'tr', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ja', 'zh', 'ar'];

  const hasTranslator = () => typeof self.Translator?.create === 'function';

  // Filled in when the toolbar opens, read when translate is pressed. Keeping the
  // click free of awaits is the point: the user gesture Translator.create() needs
  // is transient, and every await before it is a chance to lose it.
  let detectedSource = null;

  let langNames = null;
  function langName(code) {
    try {
      langNames ??= new Intl.DisplayNames([chrome.i18n.getUILanguage?.() || 'en'], {
        type: 'language',
      });
      return langNames.of(code) ?? code;
    } catch {
      return code;
    }
  }

  async function loadTrPrefs() {
    if (!contextAlive()) return;
    try {
      const got = await chrome.storage.local.get(TR_KEY);
      Object.assign(trPrefs, got[TR_KEY] ?? {});
    } catch (e) {
      if (!isInvalidated(e)) log(`${TAG} ceviri tercihleri okunamadi`, e);
    }
  }

  async function saveTrPrefs() {
    if (!contextAlive()) return;
    try {
      await chrome.storage.local.set({ [TR_KEY]: { ...trPrefs } });
    } catch (e) {
      if (!isInvalidated(e)) log(`${TAG} ceviri tercihleri yazilamadi`, e);
    }
  }

  /** Best-effort source detection; the API needs a source and guessing wrong is
   *  worse than asking Chrome. Falls back to the document language. */
  async function detectLang(text) {
    try {
      if (typeof self.LanguageDetector?.create === 'function') {
        const d = await LanguageDetector.create();
        const [top] = await d.detect(text);
        d.destroy?.();
        if (top?.detectedLanguage) return top.detectedLanguage;
      }
    } catch (e) {
      log(`${TAG} dil tespiti basarisiz`, e);
    }
    return (document.documentElement.lang || navigator.language || 'en').split('-')[0];
  }

  /**
   * The single call the rest of the file makes. Everything about WHERE the model
   * runs is behind it, so if the content script ever turns out to be the wrong
   * place for it, only this function moves.
   */
  async function translatePassage(text, onProgress) {
    if (!hasTranslator()) throw new Error('NO_API');

    const target = trPrefs.target;
    // Prepared when the toolbar opened. Falling back to the document language keeps
    // the click free of awaits even when detection never ran.
    const source =
      detectedSource ?? (document.documentElement.lang || navigator.language || 'en').split('-')[0];
    if (source === target) return { source, target, text, same: true };

    const translator = await Translator.create({
      sourceLanguage: source,
      targetLanguage: target,
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => onProgress?.(e.loaded));
      },
    });

    try {
      return { source, target, text: await translator.translate(text), same: false };
    } finally {
      translator.destroy?.();
    }
  }

  /* --- result card ------------------------------------------------------------
   * Lives in the note layer, which already knows how to position a card against a
   * range. The translation is offered as a note rather than kept in a panel of its
   * own: a translation you want to keep IS a note about that passage.
   * -------------------------------------------------------------------------- */

  function openTranslateCard(range, body) {
    if (!nShadow) return;
    nShadow.querySelector('.card')?.remove();
    noteOpenId = null;
    notePendingRange = range;

    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.theme = prefs.theme === 'dark' ? 'dark' : 'light';
    card.dataset.role = 'translate';
    card.append(body);

    const rects = rectsOf(range);
    const last = rects[rects.length - 1];
    const left = last ? last.right + window.scrollX - 120 : window.scrollX + 40;
    const top = last ? last.bottom + window.scrollY + 10 : window.scrollY + 60;
    card.style.left = `${Math.max(8, Math.min(left, window.scrollX + window.innerWidth - 288))}px`;
    card.style.top = `${top}px`;

    nShadow.appendChild(card);
  }

  const trCardBody = (parts) => {
    const frag = document.createDocumentFragment();
    for (const p of parts) frag.appendChild(p);
    return frag;
  };

  const trLine = (cls, text) => {
    const el = document.createElement('p');
    el.className = cls;
    el.textContent = text;
    return el;
  };

  async function translateSelection() {
    const range = pendingRange ?? (hoveredId ? live.get(hoveredId)?.range : null);
    if (!range) return;
    const text = range.toString().trim();
    if (!text) return;

    const kept = range.cloneRange();

    if (!hasTranslator()) {
      return openTranslateCard(
        kept,
        trCardBody([trLine('quote', msg('trUnavailable', 'Translation is not available in this browser.'))]),
      );
    }

    // Shown immediately: the first use of a language pair downloads a model, and
    // several silent seconds read as a broken button.
    const status = trLine('quote', msg('trWorking', 'Translating…'));
    openTranslateCard(kept, trCardBody([status]));

    try {
      const out = await translatePassage(text, (loaded) => {
        status.textContent = `${msg('trDownloading', 'Downloading language model…')} ${Math.round(loaded * 100)}%`;
      });

      const head = trLine(
        'quote',
        out.same
          ? msg('trAlready', 'Already in the target language.')
          : `${langName(out.source)} → ${langName(out.target)}`,
      );

      const body = document.createElement('div');
      body.className = 'tr-out';
      body.textContent = out.text;

      const actions = document.createElement('div');
      actions.className = 'actions';
      actions.innerHTML =
        `<button class="primary" data-note-act="save">${msg('trKeep', 'Keep as note')}</button>` +
        `<button data-note-act="cancel">${msg('noteCancel', 'Cancel')}</button>`;

      // The translation IS the note text if it is kept, so it goes into a textarea
      // the save handler already knows how to read.
      const ta = document.createElement('textarea');
      ta.value = out.text;
      ta.hidden = true;

      openTranslateCard(kept, trCardBody([head, body, ta, actions]));
    } catch (e) {
      // The cause is shown, not hidden behind one sentence. Chrome reports several
      // distinct conditions here — no gesture, an unsupported origin, a pair with no
      // model — and collapsing them into "failed" deletes the only useful part.
      console.warn(`${TAG} ceviri basarisiz:`, e);
      const detail = `${e?.name ?? 'Error'}: ${e?.message ?? String(e)}`;
      openTranslateCard(
        kept,
        trCardBody([
          trLine('quote', msg('trFailed', 'Translation failed.')),
          trLine('tr-why', detail),
        ]),
      );
    }
  }

  /* --- target language menu ---------------------------------------------------
   * On the toolbar, next to the passage, because that is where the decision gets
   * made. The full list stays in the popup; this is the short one.
   * -------------------------------------------------------------------------- */

  function toggleLangMenu() {
    if (!shadow) return;
    const existing = shadow.querySelector('.langs');
    if (existing) return existing.remove();

    const box = document.createElement('div');
    box.className = 'langs';
    const codes = [...new Set([trPrefs.target, ...QUICK_LANGS])];
    for (const code of codes) {
      const b = document.createElement('button');
      b.dataset.lang = code;
      b.textContent = langName(code);
      if (code === trPrefs.target) b.className = 'on';
      box.appendChild(b);
    }
    shadow.querySelector('.bar')?.appendChild(box);
  }

  async function setTargetLang(code) {
    trPrefs.target = code;
    trPrefs.enabled = true;
    await saveTrPrefs();
    shadow?.querySelector('.langs')?.remove();
    refreshLangButton();
  }

  function refreshLangButton() {
    const b = shadow?.querySelector('[data-act="translate"] .code');
    if (b) b.textContent = trPrefs.target.toUpperCase();
  }

  // --- 11. startup ---------------------------------------------------------

  /**
   * One entry point for everything the context menu can ask for, so the menu never
   * needs to know how any of it works.
   */
  async function runCommand(command, value) {
    const sel = getSelection();
    const range = sel && !sel.isCollapsed && sel.rangeCount ? sel.getRangeAt(0) : null;

    switch (command) {
      case 'color':
        if (range) await applyToSelection(range, { color: value });
        break;

      case 'underline':
        if (range) await applyToSelection(range, { underline: true });
        break;

      case 'note':
        // The range is kept, not the selection: the card is about to take focus and
        // clearing the selection below would otherwise take the range with it.
        if (range) openNoteCard(null, range.cloneRange());
        break;

      case 'panel':
        prefs.open = !prefs.open;
        syncPanelChrome();
        renderPanel();
        await savePrefs();
        break;

      case 'preview':
        // A no-op on anything that is not a raw .md file, rather than an error: the
        // menu is one list for every page and cannot know what it is looking at.
        if (canPreview()) setPreview(!prefs.preview);
        break;

      case 'clear':
        await clearPage();
        break;

      default:
        log(`${TAG} bilinmeyen komut: ${command}`);
    }

    sel?.removeAllRanges();
  }
  function onMouseUp(e) {
    if (host?.contains(e.target)) return;

    const sel = getSelection();
    const hasSelection = sel && !sel.isCollapsed && sel.toString().trim().length > 0;

    if (hasSelection) {
      pendingRange = sel.getRangeAt(0);
      hoveredId = null;
      // If the selection lands on an existing highlight, show its active styles.
      const idx = buildIndex();
      const off = rangeToOffsets(idx, pendingRange);
      markActive(off && byId(findOverlapping(off.start, off.end)?.id));
      showToolbar(pendingRange.getBoundingClientRect());
      return;
    }

    const id = highlightAt(e.clientX, e.clientY);
    if (id) {
      hoveredId = id;
      pendingRange = null;
      markActive(byId(id));
      const rects = live.get(id).range.getClientRects();
      showToolbar(rects[0] ?? { top: e.clientY, left: e.clientX, bottom: e.clientY + 16 });
      return;
    }

    hideToolbar();
  }

  /**
   * Re-anchor when the DOM changes after load.
   *
   * Why it is needed (measured): another extension called "Markdown Reader" on the
   * user's browser converts .md files to HTML. Our index is built at document_idle;
   * if that extension renders AFTER us, every range becomes invalid and the
   * highlights disappear. The same applies to SPAs, lazy loading and infinite scroll.
   *
   * Our own UI ([data-dh-ui]) does not trigger it, and because the CSS Custom
   * Highlight API never touches the DOM, painting cannot re-trigger itself
   * (no infinite-loop risk).
   */
  function watchDom() {
    let timer = null;

    const observer = new MutationObserver((records) => {
      const relevant = records.some((r) => {
        const t = r.target;
        return !(t.nodeType === Node.ELEMENT_NODE && t.closest?.(`[${UI_ATTR}]`));
      });
      if (!relevant) return;

      clearTimeout(timer);
      timer = setTimeout(() => {
        const index = buildIndex();
        const before = live.size;
        applyAll(index);
        if (live.size !== before) {
          log(`${TAG} DOM degisti -> yeniden baglandi: ${before} -> ${live.size} cizili`);
        }
      }, 400); // debounce: wait for the render burst to settle
    });

    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  /**
   * Manual diagnosis from the page console: __docHL.dump()
   * Persistence can break in three places — the record is not written, the hash
   * does not match, or the anchor does not bind. This dump tells the three apart.
   */
  async function dump() {
    const all = await chrome.storage.local.get(null);
    const docs = Object.keys(all).filter((k) => k.startsWith('doc:'));
    const hashes = Object.keys(all).filter((k) => k.startsWith('hash:'));
    const index = buildIndex();
    const liveHash = await sha256(index.text.replace(/\s+/g, ' ').trim());

    console.group(`${TAG} dump`);
    console.log('frame mi           :', IN_FRAME ? 'EVET (icerik hash birincil)' : 'hayir (URL birincil)');
    console.log('kayit anahtari     :', IN_FRAME ? frameKey(state.hash) : docKey(state.url));
    console.log('bu sayfanin hash i :', liveHash);
    console.log('init sirasindaki   :', state.hash, liveHash === state.hash ? '(ayni)' : '(DEGISTI!)');
    console.log('normalize url      :', state.url);
    console.log('kayit bulundu mu   :', state.foundVia);
    console.log('yuklenen highlight :', state.highlights.length);
    console.log('ekranda cizili     :', live.size);
    console.log("storage doc: anahtarlari :", docs);
    console.log('storage hash: anahtarlari :', hashes);
    console.log('kayitli doc URL leri     :', docs.map((k) => k.slice(4)));
    console.table(
      state.highlights.map((h) => {
        const hit = resolveAnchor(index, h.anchor);
        return {
          style: h.style,
          metin: h.anchor.exact.slice(0, 30),
          kayitli: `${h.anchor.start}-${h.anchor.end}`,
          bulundu: hit ? `${hit.start}-${hit.end}` : 'ORPHAN',
        };
      }),
    );
    console.groupEnd();
    return { liveHash, stateHash: state.hash, docs, hashes, state, dead };
  }

  async function init() {
    if (!HAS_HIGHLIGHT_API) {
      console.error(`${TAG} CSS Custom Highlight API yok (Chrome 105+ gerekli) — render edilemez`);
      return;
    }

    try {
      // Read the diagnostics flag first — every log() below depends on it.
      try {
        const v = await chrome.storage.local.get(DEBUG_KEY);
        DEBUG = v[DEBUG_KEY] === true;
      } catch {
        DEBUG = false;
      }
      log(`${TAG} yuklendi:`, location.href, `(${document.contentType})`);

      // Preferences decide whether to render, and rendering must happen BEFORE the
      // first index is built: anchoring against the raw text and then re-rendering
      // resolves every mark twice and flashes unrendered source in between.
      if (isTopFrame) {
        await loadPrefs();
        if (prefs.preview && MD_URL.test(location.pathname)) applyPreviewDom(true);
      }

      const index = buildIndex();

      // Build nothing in empty or tiny frames — with allFrames:true the script also
      // runs in ad and tracking frames, and a toolbar plus MutationObserver is not
      // free. This threshold does not apply to a top-level page.
      if (IN_FRAME && index.text.trim().length < MIN_FRAME_TEXT) {
        log(`${TAG} frame atlandi (metin ${index.text.trim().length} karakter):`, location.href);
        return;
      }

      // Read before the sheet is written, so the first paint already uses the user's
      // colours instead of flashing the defaults.
      try {
        const got = await chrome.storage.local.get(PALETTE_KEY);
        custom = got[PALETTE_KEY] ?? {};
      } catch {
        custom = {};
      }
      ensureStyleSheet();
      buildToolbar();
      buildNoteLayer();
      await loadTrPrefs();
      refreshLangButton();
      if (isTopFrame) buildPanel();

      await load(index);
      const orphan = applyAll(index);

      document.addEventListener('mouseup', onMouseUp);
      document.addEventListener('scroll', hideToolbar, { passive: true });
      window.addEventListener('resize', () => applyAll(buildIndex()), { passive: true });
      document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (noteOpenId) return closeNoteCard();
        hideToolbar();
      });

      watchDom();

      // Commands from the context menu. The menu runs in the service worker, which can
      // see neither the selection nor the page, so everything it offers is carried out
      // here. getSelection() is still valid at this point: opening a context menu does
      // not clear the selection.
      chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
        if (msg?.type !== 'dh-command') return false;
        runCommand(msg.command, msg.value)
          .then(() => sendResponse({ ok: true }))
          .catch((e) => {
            log(`${TAG} komut basarisiz: ${msg.command}`, e);
            sendResponse({ ok: false, error: String(e?.message ?? e) });
          });
        return true; // async response
      });

      // The popup writes the palette; the page repaints without a reload. Storage
      // events are the only channel that reaches an already-injected script.
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (changes[PALETTE_KEY]) {
          custom = changes[PALETTE_KEY].newValue ?? {};
          refreshPalette();
        }
        if (changes[TR_KEY]) {
          Object.assign(trPrefs, changes[TR_KEY].newValue ?? {});
          refreshLangButton();
        }
      });

      // Diagnostics + test surface. The anchoring functions are exposed as well:
      // tools/test-engine.mjs verifies them under jsdom, with no browser needed.
      window.__docHL = {
        dump,
        setDebug,
        state,
        live,
        sha256,
        buildIndex,
        rangeToOffsets,
        offsetsToRange,
        makeAnchor,
        resolveAnchor,
        findOverlapping,
        normalizeUrl,
        migrate,
        applyToSelection,
        patchHighlight,
        removeHighlight,
        clearPage,
        applyAll,
        collectHeadings,
        isRawTextDocument,
        prefs,
        PANEL_W,
        HANDLE_W,
        openNoteCard,
        closeNoteCard,
        renderNoteDots,
        PALETTE,
        paletteCss,
        stamp,
        trPrefs,
        hasTranslator,
        langName,
        QUICK_LANGS,
        runCommand,
        renderMarkdown,
        mdInline,
        canPreview,
        setPreview,
        applyPageChrome,
        syncPanelChrome,
      };

      // Full state on one line: this tells you at which stage a problem occurs.
      log(
        `${TAG} hazir — kayit:${state.foundVia} | yuklenen:${state.highlights.length} ` +
          `| cizili:${live.size} | orphan:${orphan} | hash:${state.hash} | ${IN_FRAME ? 'IFRAME' : 'top'} | v${chrome.runtime.getManifest().version}`,
      );
      log(`${TAG} ayrinti icin: __docHL.dump()`);
    } catch (err) {
      // If init half-fails the toolbar never opens and the reason stays invisible.
      console.error(`${TAG} init BASARISIZ:`, err);
    }
  }

  /* --- TANI KOPRUSU ---------------------------------------------------------
   * A content script runs in an ISOLATED WORLD: window.__docHL is INVISIBLE to
   * page scripts and to browser automation. That made problems like "why did the
   * highlight vanish" impossible to diagnose in the browser — the only route was
   * asking the user to paste console output.
   *
   * This bridge publishes NUMERIC DIAGNOSTICS ONLY: counts, key names, state
   * labels. Highlight TEXT, anchor content and any other page content are NEVER
   * sent — the page already knows its own text, but it must not learn what the
   * user marked.
   *
   * Usage (page console or automation):
   *   window.addEventListener('message', e => { if (e.data?.__dochl==='diag-result') console.log(e.data.payload) })
   *   window.postMessage({ __dochl: 'diag' }, '*')
   *
   * THE REPLY COMES BACK VIA postMessage, NOT via a global. Because the content
   * script lives in an isolated world, writing `window.__dochlDiag = ...` is
   * INVISIBLE to the page — the first attempt made exactly that mistake and the
   * bridge silently returned nothing.
   * ------------------------------------------------------------------------- */
  window.addEventListener('message', (e) => {
    if (e.source !== window || e.data?.__dochl !== 'diag') return;
    const payload = {
      v: chrome.runtime.getManifest().version,
      inFrame: IN_FRAME,
      key: IN_FRAME ? frameKey(state.hash) : docKey(state.url),
      url: state.url,
      hash: state.hash,
      foundVia: state.foundVia,
      loaded: state.highlights.length,
      painted: live.size,
      styles: state.highlights.map((h) => h.style),
      dead,
      at: new Date().toISOString(),
    };
    window.postMessage({ __dochl: 'diag-result', payload }, '*');
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

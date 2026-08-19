/*
 * Doc Highlighter — highlight local and web documents, stored on your device.
 * Copyright (C) 2026 cansuk
 *
 * This program is free software: you can redistribute it and/or modify it under
 * the terms of the GNU General Public License as published by the Free Software
 * Foundation, either version 3 of the License, or (at your option) any later
 * version. See the LICENSE file, or <https://www.gnu.org/licenses/>.
 */
import { syncFileAccess, openExtensionsPage, openOnboarding } from '../shared/access.js';
import {
  originPatternFor,
  hasSitePermission,
  requestSite,
  revokeSite,
  injectNow,
  hasAllSites,
  requestAllSites,
  revokeAllSites,
} from '../shared/sites.js';
import { t, localizeDom } from '../shared/i18n.js';

localizeDom();

const REPO = 'https://github.com/cansuk/doc-highlighter';

// --- tabs -------------------------------------------------------------------

const panels = [...document.querySelectorAll('[data-panel]')];
const tabs = [...document.querySelectorAll('.tab')];

for (const b of tabs) {
  b.addEventListener('click', () => {
    for (const x of tabs) x.setAttribute('aria-selected', String(x === b));
    for (const p of panels) p.hidden = p.dataset.panel !== b.dataset.tab;
  });
}

document.getElementById('version').textContent = `v${chrome.runtime.getManifest().version}`;

// --- access: local files ----------------------------------------------------

const el = {
  fileState: document.getElementById('file-state'),
  fileTitle: document.getElementById('file-title'),
  fileDetail: document.getElementById('file-detail'),
  fixBtn: document.getElementById('fix'),
  guideBtn: document.getElementById('guide'),
  ctx: document.getElementById('ctx'),
  site: document.getElementById('site'),
  siteOrigin: document.getElementById('site-origin'),
  siteState: document.getElementById('site-state'),
  siteToggle: document.getElementById('site-toggle'),
  allState: document.getElementById('all-state'),
  allToggle: document.getElementById('all-toggle'),
};

const granted = await syncFileAccess();

el.fileState.dataset.on = granted ? 'yes' : 'no';
el.fixBtn.hidden = granted;
el.fileTitle.textContent = t(granted ? 'popupGrantedTitle' : 'popupDeniedTitle');
el.fileDetail.textContent = t(granted ? 'popupGrantedDetail' : 'popupDeniedDetail');

el.fixBtn.addEventListener('click', () => openExtensionsPage());
el.guideBtn.addEventListener('click', () => openOnboarding());

// --- access: this tab -------------------------------------------------------

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const origin = originPatternFor(tab?.url ?? '');

await render();

async function render() {
  const all = await hasAllSites();

  el.allState.textContent = t(all ? 'popupAllOn' : 'popupAllOff');
  el.allToggle.textContent = t(all ? 'popupBtnAllDisable' : 'popupBtnAllEnable');
  el.allToggle.classList.toggle('quiet', all);

  if (tab?.url?.startsWith('file://')) {
    el.ctx.textContent = t(granted ? 'popupCtxLocalActive' : 'popupCtxLocalBlocked');
    el.site.hidden = true;
    return;
  }

  if (!origin) {
    // chrome://, chrome-extension://, view-source:, Web Store — cannot be granted.
    el.ctx.textContent = tab?.url ? t('popupCtxUnsupported') : '';
    el.site.hidden = true;
    return;
  }

  el.ctx.textContent = '';

  // With all-sites on, the per-site row is meaningless — already covered.
  if (all) {
    el.site.hidden = true;
    return;
  }

  const on = await hasSitePermission(origin);
  el.site.hidden = false;
  el.siteOrigin.textContent = new URL(tab.url).host;
  el.siteState.textContent = t(on ? 'popupSiteOn' : 'popupSiteOff');
  el.siteToggle.textContent = t(on ? 'popupBtnSiteDisable' : 'popupBtnSiteEnable');
  el.siteToggle.classList.toggle('quiet', on);
}

/**
 * NOTE: permissions.request opens Chrome's native confirmation dialog, and the
 * popup MAY CLOSE while it is up. The permission is still granted; reopening the
 * popup shows the correct state. That is Chrome behaviour, not a bug of ours.
 *
 * registerContentScripts only applies to SUBSEQUENT page loads — so as soon as
 * the permission is granted we also inject into the currently open tab.
 */
el.siteToggle.addEventListener('click', async () => {
  if (await hasSitePermission(origin)) {
    await revokeSite(origin);
  } else {
    if (!(await requestSite(origin))) return;
    if (tab?.id != null) await injectNow(tab.id);
  }
  await render();
});

el.allToggle.addEventListener('click', async () => {
  if (await hasAllSites()) {
    await revokeAllSites();
  } else {
    if (!(await requestAllSites())) return;
    if (tab?.id != null && origin) await injectNow(tab.id);
  }
  await render();
});

/* --- colours ----------------------------------------------------------------
 * Shown as strokes over sample words rather than as a column of squares: a
 * highlighter is judged by how text looks THROUGH it, and a swatch cannot tell
 * you that.
 *
 * The rows are built ONCE and then updated in place. Rebuilding them on every
 * input event destroyed the <input type="color"> that the native picker was
 * attached to, which slammed the picker shut the moment a colour was touched —
 * before any choice had been made.
 * ------------------------------------------------------------------------- */

const PALETTE_KEY = 'dhPalette';
const INK = '#1f2937';
const DEFAULTS = {
  yellow: '#ffd54a',
  green: '#8ee6a8',
  pink: '#ffa8c5',
  blue: '#9ecbff',
  orange: '#ff9c47',
  purple: '#d9c4ff',
  underline: '#e11d48',
};
const AAA = 7;

const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

const strokeBox = document.getElementById('strokes');
let custom = (await chrome.storage.local.get(PALETTE_KEY))[PALETTE_KEY] ?? {};
const colourOf = (name) => custom[name] || DEFAULTS[name];

/** name -> { mark, ratio, input } so a change can touch one row, not all of them. */
const rows = new Map();

function buildStrokes() {
  strokeBox.textContent = '';
  rows.clear();

  for (const name of Object.keys(DEFAULTS)) {
    const isRule = name === 'underline';

    // A LABEL, not a button. An <input> inside a <button> is invalid HTML and the
    // button swallows the click: measured, the input never received it, which is
    // why the picker needed seven or eight tries to open. A label forwards the
    // click to its input natively, so one click anywhere on the row is enough.
    const btn = document.createElement('label');
    btn.className = 'stroke';
    if (isRule) btn.dataset.kind = 'rule';

    const mark = document.createElement('span');
    mark.className = 'mark';
    const word = document.createElement('em');
    word.textContent = t(`tb${name[0].toUpperCase()}${name.slice(1)}`) || name;
    mark.appendChild(word);

    const ratio = document.createElement('span');
    ratio.className = 'ratio';

    // The colour input covers the row and is invisible: the row itself is the
    // control, and the native picker opens from where the eye already is.
    const input = document.createElement('input');
    input.type = 'color';
    input.className = 'picker';
    input.value = colourOf(name);
    input.setAttribute('aria-label', word.textContent);

    // input fires continuously while the picker is open, change when it is
    // committed. Both write, so the page previews live; NEITHER rebuilds the DOM.
    input.addEventListener('input', () => applyColour(name, input.value));
    input.addEventListener('change', () => applyColour(name, input.value));

    btn.append(mark, ratio, input);
    strokeBox.appendChild(btn);
    rows.set(name, { mark, ratio, input });
    paintRow(name);
  }
}

/** Updates one row in place. Never replaces the input element. */
function paintRow(name) {
  const row = rows.get(name);
  if (!row) return;
  const colour = colourOf(name);

  // The stroke is a ::before, which cannot be styled from JS directly — so the
  // colour travels through a custom property the rule reads.
  row.mark.style.setProperty('--c', colour);

  if (name === 'underline') {
    row.ratio.textContent = '—';
    row.ratio.className = 'ratio na';
    row.ratio.title = t('qmRuleNoRatio');
  } else {
    const c = contrast(colour, INK);
    row.ratio.textContent = `${c.toFixed(1)}:1`;
    row.ratio.className = c < AAA ? 'ratio low' : 'ratio';
    row.ratio.title = c < AAA ? t('qmContrastLow') : t('qmContrastOk');
  }
}

async function applyColour(name, value) {
  custom = { ...custom, [name]: value };
  paintRow(name);
  // Straight to storage: the content script listens and repaints every open page,
  // so the choice is judged on real text while the picker is still open.
  await chrome.storage.local.set({ [PALETTE_KEY]: custom });
}

document.getElementById('palette-reset').addEventListener('click', async () => {
  custom = {};
  await chrome.storage.local.remove(PALETTE_KEY);
  for (const [name, row] of rows) {
    row.input.value = DEFAULTS[name];
    paintRow(name);
  }
});

buildStrokes();

// --- about ------------------------------------------------------------------

document.getElementById('lnk-src').href = REPO;
document.getElementById('lnk-bug').href = `${REPO}/issues`;
document.getElementById('lnk-priv').href = `${REPO}/blob/main/PRIVACY.md`;
document.getElementById('lnk-guide').addEventListener('click', (e) => {
  e.preventDefault();
  openOnboarding();
});

/* --- translate --------------------------------------------------------------
 * Chrome's built-in Translator runs the model on the device. That is the whole
 * reason the feature is here: sending a passage to a translation service would
 * break the promise the rest of the extension is built on.
 *
 * Only the target language is configured. There is no on/off switch, because the
 * button on the selection toolbar IS the switch — nothing translates until it is
 * pressed, so a second toggle would be a setting that does nothing.
 * ------------------------------------------------------------------------- */

const TR_KEY = 'dhTranslate';

// Codes only. Names come from Intl.DisplayNames, in the reader's own language, so
// no list of language names is kept or translated anywhere in this project.
const TARGETS = [
  'en', 'tr', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'pl', 'sv', 'da', 'fi', 'cs',
  'el', 'ro', 'hu', 'uk', 'ru', 'ar', 'he', 'fa', 'hi', 'bn', 'ja', 'ko', 'zh',
  'th', 'vi', 'id', 'ms',
];

const trPrefs = { target: 'en', ...((await chrome.storage.local.get(TR_KEY))[TR_KEY] ?? {}) };

const badge = document.getElementById('tr-badge');
const field = document.getElementById('tr-field');
const select = document.getElementById('tr-target');
const trNote = document.getElementById('tr-note');

// The API lives on the page, not on chrome.*: a feature check, not a version check.
const translatorHere = typeof self.Translator?.create === 'function';

if (!translatorHere) {
  badge.textContent = t('qmUnavailable');
  trNote.textContent = t('trNeedsChrome');
} else {
  badge.textContent = t('qmReady');
  badge.classList.add('ok');
  field.hidden = false;
  trNote.textContent = t('trModelNote');

  let names;
  try {
    names = new Intl.DisplayNames([chrome.i18n.getUILanguage()], { type: 'language' });
  } catch {
    names = null;
  }

  const options = TARGETS.map((code) => ({ code, label: names?.of(code) ?? code })).sort((a, b) =>
    a.label.localeCompare(b.label),
  );

  for (const { code, label } of options) {
    const o = document.createElement('option');
    o.value = code;
    o.textContent = label;
    if (code === trPrefs.target) o.selected = true;
    select.appendChild(o);
  }

  select.addEventListener('change', async () => {
    trPrefs.target = select.value;
    // The content script listens for this and relabels the toolbar button, so the
    // change is visible on the page without a reload.
    await chrome.storage.local.set({ [TR_KEY]: { ...trPrefs } });
  });
}

/* --- motion -----------------------------------------------------------------
 * A note dot pulses once when it first appears, which is what makes a small mark
 * findable in a page of text. It is under the WCAG flash threshold — one cycle
 * per 1.5s on a small low-contrast ring, against a limit of three per second —
 * but motion is not only a seizure question, and nobody should have to justify
 * wanting it gone.
 *
 * prefers-reduced-motion is already honoured without this switch. The switch is
 * for everyone who never set that flag.
 * ------------------------------------------------------------------------- */

const PREFS_KEY = 'dhPanelPrefs';
const panelPrefs = (await chrome.storage.local.get(PREFS_KEY))[PREFS_KEY] ?? {};

const pulseBox = document.getElementById('pulse');
pulseBox.checked = panelPrefs.pulse !== false;

pulseBox.addEventListener('change', async () => {
  // Merged, not replaced: this key also holds the panel side, theme and preview.
  const current = (await chrome.storage.local.get(PREFS_KEY))[PREFS_KEY] ?? {};
  await chrome.storage.local.set({ [PREFS_KEY]: { ...current, pulse: pulseBox.checked } });
});

/* --- recent -----------------------------------------------------------------
 * What you marked, most recent first, grouped by where you marked it.
 *
 * The records are already keyed by document, so this reads them rather than
 * keeping a second list — nothing new is stored, and nothing can fall out of
 * step with what the pages actually hold.
 *
 * Times come from Intl.RelativeTimeFormat and places from the URL, so no
 * sentence here needed translating into either locale.
 * ------------------------------------------------------------------------- */

const DOCS_SHOWN = 8;
const MARKS_PER_DOC = 3;

const recentBox = document.getElementById('recent');

const uiLang = (() => {
  try {
    return chrome.i18n.getUILanguage();
  } catch {
    return undefined;
  }
})();

const rtf = (() => {
  try {
    return new Intl.RelativeTimeFormat(uiLang, { numeric: 'auto' });
  } catch {
    return null;
  }
})();

const UNITS = [
  ['year', 31536000],
  ['month', 2592000],
  ['week', 604800],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
];

function ago(ts) {
  if (!ts || !rtf) return '';
  const secs = (ts - Date.now()) / 1000;
  for (const [unit, size] of UNITS) {
    if (Math.abs(secs) >= size) return rtf.format(Math.round(secs / size), unit);
  }
  return rtf.format(Math.round(secs), 'second');
}

/** A place a reader recognises: the site, or the file they opened. */
function placeOf(rec, key) {
  if (!rec?.url) return rec?.title || t('qmEmbedded');
  try {
    const u = new URL(rec.url);
    if (u.protocol === 'file:') return decodeURIComponent(u.pathname.split('/').pop()) || u.pathname;
    return u.host.replace(/^www\./, '');
  } catch {
    return rec.url || key;
  }
}

async function drawRecent() {
  const all = await chrome.storage.local.get(null);

  const docs = Object.entries(all)
    .filter(([k, v]) => k.startsWith('doc:') && Array.isArray(v?.highlights) && v.highlights.length)
    .map(([key, rec]) => ({ key, rec }))
    .sort((a, b) => (b.rec.updatedAt ?? 0) - (a.rec.updatedAt ?? 0))
    .slice(0, DOCS_SHOWN);

  recentBox.textContent = '';

  if (!docs.length) {
    const p = document.createElement('p');
    p.className = 'none';
    p.textContent = t('qmNoRecent');
    recentBox.appendChild(p);
    return;
  }

  for (const { key, rec } of docs) {
    const wrap = document.createElement('div');
    wrap.className = 'doc';

    const head = document.createElement('a');
    head.href = rec.url ?? '#';
    head.title = rec.title || rec.url || '';
    if (rec.url) {
      head.addEventListener('click', (e) => {
        e.preventDefault();
        chrome.tabs.create({ url: rec.url });
      });
    }

    const where = document.createElement('span');
    where.className = 'where';
    where.textContent = placeOf(rec, key);

    const when = document.createElement('span');
    when.className = 'when';
    when.textContent = ago(rec.updatedAt);
    when.title = rec.updatedAt ? new Date(rec.updatedAt).toLocaleString(uiLang) : '';

    head.append(where, when);
    wrap.appendChild(head);

    // Newest first inside the document too: the reason you opened this list is
    // almost always the thing you did last.
    const marks = [...rec.highlights].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));

    const list = document.createElement('ul');
    for (const h of marks.slice(0, MARKS_PER_DOC)) {
      const li = document.createElement('li');

      const sw = document.createElement('span');
      if (h.color) {
        sw.className = 'sw';
        sw.style.background = colourOf(h.color);
      } else if (h.note) {
        sw.className = 'sw';
        sw.style.background = h.noteFrom === 'translate' ? '#2563eb' : '#d97706';
        sw.style.borderRadius = h.noteFrom === 'translate' ? '50%' : '2px';
      } else {
        sw.className = 'sw rule';
        sw.style.color = colourOf('underline');
      }

      const ex = document.createElement('span');
      ex.className = 'ex';
      const quote = (h.anchor?.exact ?? '').replace(/\s+/g, ' ').trim();
      ex.textContent = h.note ? `${h.note.replace(/\s+/g, ' ').trim()}` : quote;
      ex.title = quote;

      li.append(sw, ex);
      list.appendChild(li);
    }
    wrap.appendChild(list);

    if (marks.length > MARKS_PER_DOC) {
      const more = document.createElement('div');
      more.className = 'more';
      more.textContent = t('qmMore').replace('{n}', String(marks.length - MARKS_PER_DOC));
      wrap.appendChild(more);
    }

    recentBox.appendChild(wrap);
  }
}

drawRecent();

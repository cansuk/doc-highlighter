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

    const btn = document.createElement('button');
    btn.className = 'stroke';
    btn.type = 'button';
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

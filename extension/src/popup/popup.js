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

/* --- rail ------------------------------------------------------------------
 * Tabs, not a scrolling list: the four things this menu does are unrelated to
 * each other, and stacking them would make the one you came for the one you have
 * to scroll past.
 * ------------------------------------------------------------------------- */

const panels = [...document.querySelectorAll('[data-panel]')];
const tabs = [...document.querySelectorAll('.rail button')];

for (const b of tabs) {
  b.addEventListener('click', () => {
    for (const x of tabs) x.setAttribute('aria-selected', String(x === b));
    for (const p of panels) p.hidden = p.dataset.panel !== b.dataset.tab;
  });
}

// --- quick: local file access -----------------------------------------------

const el = {
  status: document.getElementById('status'),
  title: document.getElementById('title'),
  detail: document.getElementById('detail'),
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

el.status.dataset.state = granted ? 'granted' : 'denied';
el.fixBtn.hidden = granted;
el.title.textContent = t(granted ? 'popupGrantedTitle' : 'popupDeniedTitle');
el.detail.textContent = t(granted ? 'popupGrantedDetail' : 'popupDeniedDetail');

el.fixBtn.addEventListener('click', () => openExtensionsPage());
el.guideBtn.addEventListener('click', () => openOnboarding());

// --- quick: active tab ------------------------------------------------------

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const origin = originPatternFor(tab?.url ?? '');

await render();

async function render() {
  const all = await hasAllSites();

  el.allState.textContent = t(all ? 'popupAllOn' : 'popupAllOff');
  el.allToggle.textContent = t(all ? 'popupBtnAllDisable' : 'popupBtnAllEnable');
  el.allToggle.classList.toggle('ghost', all);

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
  el.siteToggle.classList.toggle('ghost', on);
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

/* --- palette ----------------------------------------------------------------
 * The defaults were chosen by measurement, not by eye: every one clears WCAG AAA
 * against the ink, and they are kept apart in brightness so they stay
 * distinguishable under colour vision deficiency. A custom colour is the user's
 * call — but the contrast is shown as it is picked, and flagged when it drops
 * below AAA, because "my highlights are unreadable" is otherwise discovered later
 * and blamed on the extension.
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

const swatchBox = document.getElementById('swatches');
const sampleLine = document.getElementById('sample-line');
let custom = (await chrome.storage.local.get(PALETTE_KEY))[PALETTE_KEY] ?? {};

const colourOf = (name) => custom[name] || DEFAULTS[name];

function drawPalette() {
  swatchBox.textContent = '';

  for (const name of Object.keys(DEFAULTS)) {
    const row = document.createElement('div');
    row.className = 'swatch';

    const input = document.createElement('input');
    input.type = 'color';
    input.value = colourOf(name);
    input.addEventListener('input', () => setColour(name, input.value));

    const label = document.createElement('span');
    label.className = 'name';
    label.textContent = t(`tb${name[0].toUpperCase()}${name.slice(1)}`) || name;

    const ratio = document.createElement('span');
    ratio.className = 'ratio';
    if (name === 'underline') {
      // Underline is a rule drawn under the text, not a background behind it, so
      // the text-contrast rule does not apply to it.
      ratio.textContent = '—';
    } else {
      const c = contrast(colourOf(name), INK);
      ratio.textContent = `${c.toFixed(1)}:1`;
      ratio.classList.toggle('low', c < AAA);
      ratio.title = c < AAA ? t('qmContrastLow') : t('qmContrastOk');
    }

    row.append(input, label, ratio);
    swatchBox.appendChild(row);
  }

  drawSample();
}

function drawSample() {
  sampleLine.textContent = '';
  for (const name of Object.keys(DEFAULTS)) {
    if (name === 'underline') continue;
    const m = document.createElement('mark');
    m.style.background = colourOf(name);
    m.textContent = ` ${t(`tb${name[0].toUpperCase()}${name.slice(1)}`) || name} `;
    sampleLine.append(m, ' ');
  }
}

async function setColour(name, value) {
  custom = { ...custom, [name]: value };
  // Written straight to storage: the content script listens for the change and
  // repaints every open page without a reload.
  await chrome.storage.local.set({ [PALETTE_KEY]: custom });
  drawPalette();
}

document.getElementById('palette-reset').addEventListener('click', async () => {
  custom = {};
  await chrome.storage.local.remove(PALETTE_KEY);
  drawPalette();
});

drawPalette();

// --- about ------------------------------------------------------------------

document.getElementById('version').textContent = `v${chrome.runtime.getManifest().version}`;
document.getElementById('lnk-src').href = REPO;
document.getElementById('lnk-bug').href = `${REPO}/issues`;
document.getElementById('lnk-priv').href = `${REPO}/blob/main/PRIVACY.md`;
document.getElementById('lnk-guide').addEventListener('click', (e) => {
  e.preventDefault();
  openOnboarding();
});

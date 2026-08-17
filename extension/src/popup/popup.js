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
  allSites: document.getElementById('all-sites'),
  allState: document.getElementById('all-state'),
  allToggle: document.getElementById('all-toggle'),
};

// --- local file access ------------------------------------------------------

const granted = await syncFileAccess();

el.status.dataset.state = granted ? 'granted' : 'denied';
el.fixBtn.hidden = granted;
el.title.textContent = t(granted ? 'popupGrantedTitle' : 'popupDeniedTitle');
el.detail.textContent = t(granted ? 'popupGrantedDetail' : 'popupDeniedDetail');

el.fixBtn.addEventListener('click', () => openExtensionsPage());
el.guideBtn.addEventListener('click', () => openOnboarding());

// --- active tab -------------------------------------------------------------

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const origin = originPatternFor(tab?.url ?? '');

await render();

async function render() {
  const all = await hasAllSites();

  // --- the "all sites" row: always visible ----------------------------------
  el.allState.textContent = t(all ? 'popupAllOn' : 'popupAllOff');
  el.allToggle.textContent = t(all ? 'popupBtnAllDisable' : 'popupBtnAllEnable');
  el.allToggle.classList.toggle('ghost', all);

  // --- active tab ------------------------------------------------------------
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

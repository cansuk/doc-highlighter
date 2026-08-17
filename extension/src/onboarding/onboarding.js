/*
 * Doc Highlighter — highlight local and web documents, stored on your device.
 * Copyright (C) 2026 cansuk
 *
 * This program is free software: you can redistribute it and/or modify it under
 * the terms of the GNU General Public License as published by the Free Software
 * Foundation, either version 3 of the License, or (at your option) any later
 * version. See the LICENSE file, or <https://www.gnu.org/licenses/>.
 */
import {
  LAST_INJECTION_KEY,
  extensionsPageUrl,
  openExtensionsPage,
  syncFileAccess,
  readPinned,
} from '../shared/access.js';
import { t, localizeDom } from '../shared/i18n.js';

localizeDom();

const el = {
  status: document.getElementById('status'),
  statusTitle: document.getElementById('status-title'),
  statusDetail: document.getElementById('status-detail'),
  steps: document.getElementById('steps'),
  openBtn: document.getElementById('open-extensions'),
  copyBtn: document.getElementById('copy-url'),
  recheckBtn: document.getElementById('recheck'),
  hint: document.getElementById('hint-chrome-url'),
  foot: document.getElementById('foot-text'),
  proofBox: document.getElementById('proof-box'),
  proofText: document.getElementById('proof-text'),
  pinStatus: document.getElementById('pin-status'),
  pinTitle: document.getElementById('pin-title'),
  pinDetail: document.getElementById('pin-detail'),
  pinHow: document.getElementById('pin-how'),
  pinOpenBtn: document.getElementById('pin-open'),
};

// Messages that embed a runtime value are fed through a placeholder.
// The only sources are our own _locales files and a URL we build ourselves —
// no user input is involved.
el.hint.innerHTML = t('onbHintChromeUrl', [`<code>${extensionsPageUrl()}</code>`]);
el.foot.innerHTML = t('onbFoot', ['<span class="badge-sample">!</span>']);

let pollTimer = null;

function render(granted) {
  el.status.dataset.state = granted ? 'granted' : 'denied';
  el.steps.dataset.done = String(granted);

  el.statusTitle.textContent = t(granted ? 'onbStatusGrantedTitle' : 'onbStatusDeniedTitle');
  el.statusDetail.textContent = t(granted ? 'onbStatusGrantedDetail' : 'onbStatusDeniedDetail');

  if (granted) stopPolling();
  else startPolling();
}

/**
 * Toolbar pin state. Pinning CANNOT BE DONE PROGRAMMATICALLY (see readPinned);
 * it is only read, and reflected here the moment the user pins it.
 * null = this Chrome version has no getUserSettings -> hide the section.
 */
async function renderPin() {
  const pinned = await readPinned();

  if (pinned === null) {
    el.pinStatus.closest('.pin').hidden = true;
    return;
  }

  el.pinStatus.dataset.state = pinned ? 'granted' : 'denied';
  el.pinTitle.textContent = t(pinned ? 'onbPinOnTitle' : 'onbPinOffTitle');
  el.pinDetail.textContent = t(pinned ? 'onbPinOnDetail' : 'onbPinOffDetail');
  el.pinHow.hidden = pinned;
}

async function check() {
  render(await syncFileAccess());
}

/**
 * TWO SEPARATE timers:
 *   pollTimer -> file access (1 s). STOPS once granted; its job is done.
 *   pinTimer  -> toolbar pin (1.5 s). Never stops; the user can pin the
 *                extension after granting the permission and we must catch it.
 * Folding both into one timer would kill pin watching the moment access is granted.
 */
function startPolling() {
  if (pollTimer !== null) return;
  pollTimer = setInterval(check, 1000);
}

function stopPolling() {
  if (pollTimer === null) return;
  clearInterval(pollTimer);
  pollTimer = null;
}

// --- content script liveness proof ----------------------------------------

function renderProof(record) {
  if (!record?.url) return;
  el.proofBox.dataset.state = 'seen';
  const at = new Date(record.at).toLocaleString(chrome.i18n.getUILanguage());
  el.proofText.textContent = `✔ ${at} — ${record.url}`;
}

chrome.storage.local.get(LAST_INJECTION_KEY).then((data) => renderProof(data[LAST_INJECTION_KEY]));

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes[LAST_INJECTION_KEY]) renderProof(changes[LAST_INJECTION_KEY].newValue);
});

// --- events ---------------------------------------------------------------

el.openBtn.addEventListener('click', () => openExtensionsPage());

el.copyBtn.addEventListener('click', async () => {
  await navigator.clipboard.writeText(extensionsPageUrl());
  el.copyBtn.textContent = t('onbBtnCopied');
  setTimeout(() => { el.copyBtn.textContent = t('onbBtnCopy'); }, 1500);
});

el.recheckBtn.addEventListener('click', () => {
  check();
  renderPin();
});

el.pinOpenBtn.addEventListener('click', () => openExtensionsPage());

// Re-check the moment the user comes back from the chrome://extensions tab or
// the puzzle menu — pinning usually happens there.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  check();
  renderPin();
});
window.addEventListener('focus', () => {
  check();
  renderPin();
});

check();
renderPin();
setInterval(renderPin, 1500);

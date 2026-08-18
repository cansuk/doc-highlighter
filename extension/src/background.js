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
  ONBOARDING_DONE_KEY,
  syncFileAccess,
  openOnboarding,
  debugState,
} from './shared/access.js';
import { syncDynamicScripts, grantedWebOrigins, resetDynamicScripts } from './shared/sites.js';
import { log, initDebug, setDebug } from './shared/log.js';

// Load the diagnostics flag. TOP-LEVEL AWAIT IS NOT USED: it is unreliable in a
// service worker module context. A few log lines may be dropped before the flag
// arrives — an acceptable cost.
initDebug();

// Callable by hand from the console: `self.docHL.debug()` in the SW inspector.

self.docHL = {
  setDebug,
  debug: debugState,
  sync: syncFileAccess,
  onboarding: openOnboarding,
  sites: grantedWebOrigins,
  syncSites: syncDynamicScripts,
  resetScripts: resetDynamicScripts,

  /**
   * Is the dynamic content script ACTUALLY registered?
   * Added after the "Duplicate script ID" race: it tells apart the state where a
   * permission looks granted but no registration was ever created.
   */
  async registered() {
    const scripts = await chrome.scripting.getRegisteredContentScripts();
    const origins = await grantedWebOrigins();
    console.table(scripts.map((s) => ({ id: s.id, matches: s.matches.join(','), allFrames: s.allFrames })));
    console.log('[DocHL] granted origins:', origins);
    if (origins.length && !scripts.length) {
      console.error('[DocHL] permission present but NO REGISTRATION — run self.docHL.syncSites()');
    }
    return { scripts, origins };
  },
};

// --- Lifecycle -------------------------------------------------------------

// When the file-access toggle changes, Chrome reloads the extension; onInstalled
// and onStartup DO NOT fire, only the service worker restarts. That is why the
// sync call sits at top level: state is refreshed on every SW wake.
//
// Build stamp: the Errors list on chrome://extensions never clears itself, which
// makes it easy to confuse a stale error with a new one. Every SW start logs
// which build is running; that line is expected at the top of any bug report.
const BUILD = chrome.runtime.getManifest().version;
log(`[DocHL] service worker started — v${BUILD}`);

syncFileAccess();
syncDynamicScripts();

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  log(`[DocHL] onInstalled: reason=${reason}`);
  const granted = await syncFileAccess();
  await syncDynamicScripts();

  if (reason === 'install' && !granted) {
    log('[DocHL] permission off -> opening onboarding');
    await openOnboarding();
  } else {
    log(`[DocHL] onboarding not opened (reason=${reason}, granted=${granted})`);
  }
});

chrome.runtime.onStartup.addListener(() => {
  syncFileAccess();
  syncDynamicScripts();
});

// --- Site permissions ------------------------------------------------------
// Permissions can also be changed outside the popup (chrome://extensions ->
// Site access), so registration is driven by these events rather than by the popup.

chrome.permissions.onAdded.addListener((p) => {
  log('[DocHL] permission added:', p.origins ?? p.permissions);
  syncDynamicScripts();
});

chrome.permissions.onRemoved.addListener((p) => {
  log('[DocHL] permission removed:', p.origins ?? p.permissions);
  syncDynamicScripts();
});

// --- Context menu ----------------------------------------------------------
// Same actions as the toolbar and the panel, reachable without moving the mouse
// off the passage. The menu is rebuilt from scratch on every worker start:
// removeAll first, because createContextMenus throws on a duplicate id and a
// service worker can wake many times over.

const COLORS = ['yellow', 'green', 'pink', 'blue', 'orange', 'purple'];
const MENU_ROOT = 'dh-root';

// Only where a content script can actually be listening. Without this the items
// appear on chrome:// pages too and do nothing when pressed.
const PATTERNS = ['file:///*', 'http://*/*', 'https://*/*'];

const label = (key, fallback) => chrome.i18n.getMessage(key) || fallback;

function buildContextMenu() {
  chrome.contextMenus.removeAll(() => {
    const root = { id: MENU_ROOT, title: label('extName', 'Doc Highlighter'), contexts: ['all'], documentUrlPatterns: PATTERNS };
    chrome.contextMenus.create(root);

    // Selection-only: highlighting something requires something to be selected,
    // and an item that cannot work should not be offered.
    for (const c of COLORS) {
      chrome.contextMenus.create({
        id: `dh-color-${c}`,
        parentId: MENU_ROOT,
        title: label(`tb${c[0].toUpperCase()}${c.slice(1)}`, c),
        contexts: ['selection'],
        documentUrlPatterns: PATTERNS,
      });
    }
    chrome.contextMenus.create({
      id: 'dh-underline', parentId: MENU_ROOT, title: label('tbUnderline', 'Underline'),
      contexts: ['selection'], documentUrlPatterns: PATTERNS,
    });
    chrome.contextMenus.create({
      id: 'dh-note', parentId: MENU_ROOT, title: label('tbNote', 'Note'),
      contexts: ['selection'], documentUrlPatterns: PATTERNS,
    });

    chrome.contextMenus.create({
      id: 'dh-sep1', parentId: MENU_ROOT, type: 'separator',
      contexts: ['all'], documentUrlPatterns: PATTERNS,
    });
    chrome.contextMenus.create({
      id: 'dh-panel', parentId: MENU_ROOT, title: label('cmPanel', 'Show / hide the panel'),
      contexts: ['all'], documentUrlPatterns: PATTERNS,
    });
    chrome.contextMenus.create({
      id: 'dh-preview', parentId: MENU_ROOT, title: label('cmPreview', 'Rendered / source'),
      contexts: ['all'], documentUrlPatterns: PATTERNS,
    });
    chrome.contextMenus.create({
      id: 'dh-sep2', parentId: MENU_ROOT, type: 'separator',
      contexts: ['all'], documentUrlPatterns: PATTERNS,
    });
    chrome.contextMenus.create({
      id: 'dh-clear', parentId: MENU_ROOT, title: label('tbClearAll', 'Clear all highlights on this page'),
      contexts: ['all'], documentUrlPatterns: PATTERNS,
    });

    if (chrome.runtime.lastError) log('[DocHL] context menu:', chrome.runtime.lastError.message);
  });
}

buildContextMenu();
chrome.runtime.onInstalled.addListener(buildContextMenu);

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (tab?.id == null) return;

  const id = String(info.menuItemId);
  const command = id.startsWith('dh-color-')
    ? 'color'
    : { 'dh-underline': 'underline', 'dh-note': 'note', 'dh-panel': 'panel', 'dh-preview': 'preview', 'dh-clear': 'clear' }[id];
  if (!command) return;

  try {
    await chrome.tabs.sendMessage(tab.id, {
      type: 'dh-command',
      command,
      value: command === 'color' ? id.slice('dh-color-'.length) : undefined,
    });
  } catch {
    // No content script on this tab — the page was open before the permission was
    // granted, or this is a surface Chrome does not allow. Nothing to repair here;
    // reloading the page is the fix and the popup already says so.
    log('[DocHL] context menu: bu sekmede content script yok');
  }
});
// --- Content script liveness channel ---------------------------------------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'content-alive') {
    chrome.storage.local.set({
      [LAST_INJECTION_KEY]: {
        url: msg.url,
        at: new Date().toISOString(),
      },
    });
    // If the content script really injected, the permission must have been granted.
    chrome.storage.local.set({ [ONBOARDING_DONE_KEY]: true });
    sendResponse({ ok: true });
    return false;
  }

  if (msg?.type === 'recheck-access') {
    syncFileAccess().then((granted) => sendResponse({ granted }));
    return true; // async response
  }

  return false;
});

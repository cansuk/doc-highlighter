/*
 * Notestark — highlight local and web documents, stored on your device.
 * Copyright (C) 2026 cansuk
 *
 * This program is free software: you can redistribute it and/or modify it under
 * the terms of the GNU General Public License as published by the Free Software
 * Foundation, either version 3 of the License, or (at your option) any later
 * version. See the LICENSE file, or <https://www.gnu.org/licenses/>.
 */
import { log } from './log.js';

// Single source of truth for reading and storing the file-scheme-access state.
// This permission sits OUTSIDE the Permissions API; chrome.permissions.request()
// CANNOT grant it. Only the user can, via the toggle on chrome://extensions.

export const FILE_ACCESS_KEY = 'fileAccessGranted';
export const LAST_INJECTION_KEY = 'lastInjection';
export const ONBOARDING_DONE_KEY = 'onboardingCompleted';

const TAG = '[DocHL]';

/** Ask Chrome live. Returns the real state, not a cached value. */
export async function readFileAccess() {
  if (typeof chrome.extension?.isAllowedFileSchemeAccess !== 'function') {
    console.error(`${TAG} chrome.extension.isAllowedFileSchemeAccess missing — API unreachable in this context`);
    return false;
  }
  try {
    return await chrome.extension.isAllowedFileSchemeAccess();
  } catch (err) {
    console.error(`${TAG} isAllowedFileSchemeAccess failed:`, err);
    return false;
  }
}

const ICON_SIZES = [16, 32, 48, 128];

/**
 * CAREFUL: chrome.action.setIcon({path}) resolves a relative path against the
 * CALLING SCRIPT's location, NOT the extension root. syncFileAccess() is called
 * from both src/background.js and src/popup/popup.html; there "icons/icon16.png"
 * is looked up as src/icons/... and src/popup/icons/... respectively, and fails
 * with "Failed to fetch". chrome.runtime.getURL() produces an absolute
 * chrome-extension:// URL that resolves correctly from any caller.
 */
function iconSet(granted) {
  const suffix = granted ? '' : '-off';
  return Object.fromEntries(
    ICON_SIZES.map((s) => [s, chrome.runtime.getURL(`icons/icon${s}${suffix}.png`)]),
  );
}

/** Read the live state, persist it, update icon + badge. Returns the live value. */
export async function syncFileAccess() {
  const granted = await readFileAccess();
  await chrome.storage.local.set({ [FILE_ACCESS_KEY]: granted });

  // Permission off -> muted grey icon plus a red "!" badge; on -> normal.
  // The icon itself changes because a badge alone is hard to read at 16px.
  // NOTE: setIcon only affects the TOOLBAR icon; the icon on the
  // chrome://extensions card is always manifest.icons and never changes.
  try {
    await chrome.action.setIcon({ path: iconSet(granted) });
    await chrome.action.setBadgeText({ text: granted ? '' : '!' });
    await chrome.action.setBadgeBackgroundColor({ color: '#d93025' });
    log(`${TAG} fileAccess=${granted} -> icon ${granted ? 'normal' : 'grey'}, badge "${granted ? '' : '!'}"`);
  } catch (err) {
    // Never swallow this: without it, "why did the icon not change" is unanswerable.
    console.error(`${TAG} could not update action (fileAccess=${granted}):`, err);
  }

  return granted;
}

/**
 * Is the extension pinned to the toolbar?
 *
 * IMPORTANT: an extension CANNOT PIN ITSELF in Chrome. There is no pin method on
 * chrome.action and no manifest key for it. The toolbar belongs to the user. The
 * only exception is the ExtensionSettings policy's toolbar_pin setting
 * (force_pinned / default_pinned) on managed devices — an administrator's job,
 * unreachable from the extension.
 *
 * All we can do is READ the state and guide the user.
 * getUserSettings needs Chrome 91+; older versions return "unknown".
 */
export async function readPinned() {
  if (typeof chrome.action?.getUserSettings !== 'function') return null;
  try {
    const s = await chrome.action.getUserSettings();
    return s.isOnToolbar === true;
  } catch (err) {
    console.error(`${TAG} getUserSettings failed:`, err);
    return null;
  }
}

/** One command that dumps the whole state — for diagnosis in the SW console. */
export async function debugState() {
  const state = {
    fileAccess: await readFileAccess(),
    pinned: await readPinned(),
    apiVar: typeof chrome.extension?.isAllowedFileSchemeAccess === 'function',
    extensionId: chrome.runtime.id,
    version: chrome.runtime.getManifest().version,
    storage: await chrome.storage.local.get(null),
  };
  console.table(state);
  return state;
}

/** The extension's own details page — the file-access toggle lives there. */
export function extensionsPageUrl() {
  return `chrome://extensions/?id=${chrome.runtime.id}`;
}

/**
 * chrome:// pages cannot be opened via <a href> (Chrome blocks it);
 * only chrome.tabs.create works.
 */
export async function openExtensionsPage() {
  await chrome.tabs.create({ url: extensionsPageUrl() });
}

const ONBOARDING_TAB_KEY = 'onboardingTabId';

export async function openOnboarding() {
  const url = chrome.runtime.getURL('src/onboarding/onboarding.html');

  // If an onboarding tab is already open, focus it instead of opening another.
  // (The url filter of tabs.query needs the "tabs" permission, which shows a
  // "read your browsing history" warning — so we track the tab id instead.)
  const { [ONBOARDING_TAB_KEY]: knownId } = await chrome.storage.local.get(ONBOARDING_TAB_KEY);
  if (typeof knownId === 'number') {
    try {
      const tab = await chrome.tabs.get(knownId);
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
      return tab;
    } catch {
      /* tab was closed — a new one is opened below */
    }
  }

  const tab = await chrome.tabs.create({ url });
  await chrome.storage.local.set({ [ONBOARDING_TAB_KEY]: tab.id });
  return tab;
}

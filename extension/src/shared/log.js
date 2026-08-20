/*
 * Notestark — highlight local and web documents, stored on your device.
 * Copyright (C) 2026 cansuk
 *
 * This program is free software: you can redistribute it and/or modify it under
 * the terms of the GNU General Public License as published by the Free Software
 * Foundation, either version 3 of the License, or (at your option) any later
 * version. See the LICENSE file, or <https://www.gnu.org/licenses/>.
 */
/**
 * Quiet by default, diagnostics on demand.
 *
 * Informational console.log calls were NOT deleted, they were TURNED OFF.
 * Reason: every persistence bug we hit ("the highlight vanished", "it does not
 * save") was only diagnosable through these lines; deleting them means writing
 * them again from scratch next time.
 *
 * To enable — in the console of any extension page or content page:
 *   chrome.storage.local.set({ dhDebug: true })   then reload the page
 * Shortcut inside a content page:
 *   __docHL.setDebug(true)
 *
 * console.error and user-facing console.warn stay ON at all times — those are
 * not diagnostics, they are real failures (see: no silent catch blocks).
 */

export const DEBUG_KEY = 'dhDebug';

let enabled = false;

export function isDebug() {
  return enabled;
}

export function setDebug(on) {
  enabled = !!on;
  return chrome.storage.local.set({ [DEBUG_KEY]: enabled });
}

/** Read the flag from storage. If never called, logging stays off — safe default. */
export async function initDebug() {
  try {
    const v = await chrome.storage.local.get(DEBUG_KEY);
    enabled = v[DEBUG_KEY] === true;
  } catch {
    enabled = false;
  }
  return enabled;
}

export function log(...args) {
  if (enabled) console.log(...args);
}

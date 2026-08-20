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
 * Website permissions — optional_host_permissions management.
 *
 * Why optional: putting "*://*\/*" in the manifest triggers the "read and change
 * all your data on all websites" warning at install time and pushes the Web Store
 * review onto the manual track. Declared as optional, installation stays silent;
 * the permission is requested the moment the user clicks "enable on this site",
 * from their own gesture.
 *
 * A content script cannot be declared statically for a host we have no permission
 * for, so for every granted origin we register it DYNAMICALLY via
 * chrome.scripting.registerContentScripts.
 */

import { log } from './log.js';

const DYNAMIC_SCRIPT_ID = 'notestark-web';
const CONTENT_JS = 'src/content/content.js';

/**
 * The "all sites" pattern — must match optional_host_permissions in the manifest
 * EXACTLY, otherwise chrome.permissions.request() rejects it.
 *
 * We deliberately do NOT declare this as host_permissions: that would show
 * "read and change all your data on all websites" at install time and drop the
 * Web Store review onto the manual track. As an optional permission the install
 * is silent, and the request happens on the user's own click.
 */
export const ALL_SITES = '*://*/*';

export async function hasAllSites() {
  return chrome.permissions.contains({ origins: [ALL_SITES] });
}

/** REQUIRES a user gesture — must be called from a click in the popup. */
export async function requestAllSites() {
  const granted = await chrome.permissions.request({ origins: [ALL_SITES] });
  if (granted) await syncDynamicScripts();
  return granted;
}

/**
 * Drops the all-sites permission. Individually granted site permissions are NOT
 * removed by this call — Chrome keeps them as separate records; the user turns
 * each one off from its own row.
 */
export async function revokeAllSites() {
  const removed = await chrome.permissions.remove({ origins: [ALL_SITES] });
  if (removed) await syncDynamicScripts();
  return removed;
}

/**
 * Origins that belong in the dynamic registration.
 *
 * The ONLY thing excluded is file:// — that one is already covered by the static
 * content_scripts entry.
 *
 * This used to be `startsWith('http://') || startsWith('https://')`, which
 * SILENTLY DROPPED the all-sites permission: its pattern is `*://*\/*`, which
 * starts with neither. The result was that the user granted the permission,
 * Chrome stored it, but it never reached the matches list — nothing worked on any
 * new site, and no error was raised anywhere. (Measured in the browser, Aug 2026.)
 */
const isWebOrigin = (o) => !o.startsWith('file://');

/** Builds the origin pattern to request from a tab URL. */
export function originPatternFor(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return `${u.origin}/*`;
  } catch {
    return null;
  }
}

export async function grantedWebOrigins() {
  const { origins = [] } = await chrome.permissions.getAll();
  return origins.filter(isWebOrigin);
}

export async function hasSitePermission(origin) {
  if (!origin) return false;
  return chrome.permissions.contains({ origins: [origin] });
}

/** REQUIRES a user gesture — only callable from a click in the popup or onboarding page. */
export async function requestSite(origin) {
  const granted = await chrome.permissions.request({ origins: [origin] });
  if (granted) await syncDynamicScripts();
  return granted;
}

export async function revokeSite(origin) {
  const removed = await chrome.permissions.remove({ origins: [origin] });
  if (removed) await syncDynamicScripts();
  return removed;
}

/**
 * SERIALISATION LOCK — concurrent calls used to corrupt the registration.
 *
 * syncDynamicScripts() is called from three places: service worker start,
 * onInstalled, and permissions.onAdded. When two ran at the same time both saw
 * "not registered" and both called register; the second failed with
 *     Error: Duplicate script ID 'notestark-web'
 * and the registration was NEVER created — meaning nothing worked on any site.
 *
 * Calls are chained here. ensureRegistered() additionally recovers if a stale
 * half-written registration is left behind.
 *
 * Keeps the registered dynamic content script in sync with the currently granted
 * origins. Called on every service worker wake and on every permission change, so
 * a "permission revoked but script still registered" state cannot persist.
 */
let chain = Promise.resolve();

export function syncDynamicScripts() {
  chain = chain.then(doSync, doSync);
  return chain;
}

async function doSync() {
  const origins = await grantedWebOrigins();

  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [DYNAMIC_SCRIPT_ID] });
  const isRegistered = existing.length > 0;

  if (origins.length === 0) {
    if (isRegistered) {
      await chrome.scripting.unregisterContentScripts({ ids: [DYNAMIC_SCRIPT_ID] });
      log('[DocHL] web content script unregistered (no granted origins)');
    }
    return [];
  }

  const spec = {
    id: DYNAMIC_SCRIPT_ID,
    matches: origins,
    js: [CONTENT_JS],
    runAt: 'document_idle',
    allFrames: true, // for content inside iframes (Claude artifacts etc.) — see FRAME NOTE in content.js
    persistAcrossSessions: true,
  };

  await ensureRegistered(spec, isRegistered, origins);
  return origins;
}

/**
 * REGISTRATION — an order of attempts that can escape a "half-written persistent
 * registration".
 *
 * What happened (Aug 2026): a failed registerContentScripts caused by the race
 * above left a BROKEN record on disk, because persistAcrossSessions was true.
 * Afterwards Chrome reported two contradictory errors:
 *   register -> "Duplicate script ID 'notestark-web'"
 *   update   -> "Script with ID ... does not exist or is not fully registered"
 * So the id counted as taken while no registration existed; it could neither be
 * updated nor created. getRegisteredContentScripts did NOT return it either —
 * which is why the isRegistered check cannot be trusted on its own.
 *
 * The way out is to delete ALL of this extension's dynamic registrations with an
 * argument-less unregisterContentScripts(). Order:
 *   1. update   (cheapest path when the registration really exists)
 *   2. register
 *   3. drop the id -> register
 *   4. drop EVERYTHING -> register        <- this is what breaks the deadlock
 */
async function ensureRegistered(spec, isRegistered, origins) {
  const attempts = [
    { name: 'update', run: () => chrome.scripting.updateContentScripts([spec]), skip: !isRegistered },
    { name: 'register', run: () => chrome.scripting.registerContentScripts([spec]) },
    {
      name: 'drop-id+register',
      run: async () => {
        await chrome.scripting.unregisterContentScripts({ ids: [spec.id] }).catch(() => {});
        return chrome.scripting.registerContentScripts([spec]);
      },
    },
    {
      name: 'drop-all+register',
      run: async () => {
        await chrome.scripting.unregisterContentScripts().catch(() => {});
        return chrome.scripting.registerContentScripts([spec]);
      },
    },
  ];

  const failures = [];

  for (const a of attempts) {
    if (a.skip) continue;
    try {
      await a.run();
      log(`[DocHL] web content script registered (${a.name}): ${origins.length} origin(s)`, origins);
      return true;
    } catch (err) {
      failures.push(`${a.name}: ${err?.message ?? err}`);
    }
  }

  console.error('[DocHL] content script COULD NOT BE REGISTERED — every path failed:\n  ' + failures.join('\n  '));
  return false;
}

/**
 * Inject into the granted tab RIGHT AWAY so the user does not have to reload.
 * registerContentScripts only applies to SUBSEQUENT page loads.
 */
export async function injectNow(tabId) {
  try {
    // allFrames: on pages whose content lives in an iframe (Claude artifacts,
    // embedded document viewers) injecting into the top frame alone is useless.
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: [CONTENT_JS] });
  } catch (err) {
    console.error('[DocHL] could not inject into the active tab:', err);
  }
}

/**
 * Emergency: drop every dynamic registration and rebuild.
 * From the service worker console:  await self.docHL.resetScripts()
 *
 * The "half-written persistent registration" state is handled automatically
 * inside ensureRegistered; this exists for manual intervention.
 */
export async function resetDynamicScripts() {
  const before = await chrome.scripting.getRegisteredContentScripts().catch(() => []);
  await chrome.scripting.unregisterContentScripts().catch(() => {});
  const origins = await syncDynamicScripts();
  const after = await chrome.scripting.getRegisteredContentScripts().catch(() => []);
  console.log('[DocHL] reset —', { before: before.length, after: after.length, origins });
  return after;
}

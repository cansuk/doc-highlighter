# Manifest V3 — Field Notes

Things that cost me hours while building a Chrome extension, written down so they cost
you minutes. Every entry below was hit in a real build and verified in the browser —
not collected from documentation.

The pattern repeats: **MV3 fails quietly.** Most of these produce no error at all, or
an error in a place you are not looking.

---

## 1. `setIcon` resolves paths against the *calling script*, not the extension root

**Symptom** — `Error: Failed to set icon 'icons/icon16.png': Failed to fetch`,
even though the file is definitely there.

**Cause** — a relative path passed to `chrome.action.setIcon()` is resolved against the
location of whatever script called it. Called from `src/background.js`, the lookup
becomes `src/icons/icon16.png`.

```js
// ✗ works from the extension root, fails from anywhere else
chrome.action.setIcon({ path: { 16: 'icons/icon16.png' } });

// ✓ absolute chrome-extension:// URL — correct from any caller
chrome.action.setIcon({ path: { 16: chrome.runtime.getURL('icons/icon16.png') } });
```

**Rule** — never hand a relative path to a runtime `chrome.*` API. Manifest paths are
root-relative; runtime paths are not.

---

## 2. There are two icons, and only one of them changes

| Where | Source | Changes at runtime |
|---|---|---|
| `chrome://extensions` card | `manifest.icons` | **No** — always the packaged icon |
| Toolbar | `action.default_icon`, then `setIcon()` | Yes |

Hours can be lost watching the wrong icon. State indicators belong on the toolbar icon;
the card is static.

---

## 3. Content scripts live in an isolated world

A content script shares the DOM with the page but not the JavaScript context.

```js
// in the content script
window.__myDebugHandle = { … };   // ✗ invisible to the page and to automation
```

The page cannot see it, DevTools sees it only if you switch the console's context
selector, and browser automation cannot reach it at all.

To expose anything deliberately, use `postMessage` and reply the same way:

```js
window.addEventListener('message', (e) => {
  if (e.source !== window || e.data?.__myext !== 'diag') return;
  window.postMessage({ __myext: 'diag-result', payload: collectDiagnostics() }, '*');
});
```

Send **diagnostics**, never user content. The page already knows its own text; it must
not learn what the user selected.

---

## 4. Permission patterns are not URLs

`chrome.permissions.getAll()` returns match patterns, not addresses.

```js
// ✗ silently drops the all-sites permission
const isWeb = (o) => o.startsWith('http://') || o.startsWith('https://');

// ✓ exclude what you know, keep the rest
const isWeb = (o) => !o.startsWith('file://');
```

The all-sites pattern is `*://*/*`, which starts with neither `http://` nor `https://`.
The filter above removed it, so the permission was granted, stored by Chrome, and never
reached the `matches` list. **No error anywhere** — the extension simply did nothing on
every new site.

---

## 5. Dynamic content script registration can deadlock

With `persistAcrossSessions: true`, a failed `registerContentScripts()` can leave a
half-written record on disk. Afterwards Chrome reports two contradictory errors:

```
register → Duplicate script ID 'my-script'
update   → Script with ID 'my-script' does not exist or is not fully registered
```

`getRegisteredContentScripts()` does not return it either, so an `isRegistered` check
cannot be trusted on its own.

**Escape order** — first success wins:

1. `updateContentScripts` (cheapest, when the registration really exists)
2. `registerContentScripts`
3. unregister by id → register
4. **`unregisterContentScripts()` with no arguments** → register

Step 4 is what breaks the deadlock: it drops every dynamic registration the extension
owns.

The root cause is usually concurrency — `sync()` called from service-worker start,
`onInstalled` *and* `permissions.onAdded` at once. Serialise the calls:

```js
let chain = Promise.resolve();
export function sync() {
  chain = chain.then(doSync, doSync);   // second handler: keep going after a rejection
  return chain;
}
```

---

## 6. One translation string can make the extension unloadable

```json
{ "confirmDelete": { "message": "Delete all $N$?" } }
```

```
Variable $N$ used but not defined. Could not load manifest.
```

In `_locales`, `$NAME$` is reserved syntax and requires a `placeholders` block in the
**same message**. If you substitute in JS anyway, do not use `$…$` at all:

```json
{ "confirmDelete": { "message": "Delete all {n}?" } }
```

A literal dollar sign is written `$$`.

**Worth automating** — a check that walks every message and asserts each `$X$` has a
declared placeholder. Chrome's failure mode here is total: the extension does not load.

---

## 7. Filenames starting with `_` are rejected — with two exceptions

Chrome refuses to load an unpacked extension containing a file or directory whose name
begins with `_`. The reserved exceptions are Chrome's own: **`_locales`** and
**`_metadata`**.

Practical consequence: keep `node_modules` and build tooling **outside** the folder you
load, and package only the extension directory.

---

## 8. Reloading the extension orphans content scripts in open tabs

After a reload, scripts already injected into open pages keep running but lose their
connection:

```
Uncaught (in promise) Error: Extension context invalidated.
```

The page looks alive; every `chrome.*` call throws. Detect it and say so, rather than
failing silently:

```js
const contextAlive = () => { try { return !!chrome.runtime?.id; } catch { return false; } };
const isInvalidated = (e) => /context invalidated/i.test(e?.message ?? '');
```

Also: **Chrome does not pick up file changes without an extension reload.** Editing a
content script and reloading only the page runs the old code.

---

## 9. The file-access toggle reloads the extension — but fires no lifecycle event

Flipping *Allow access to file URLs* restarts the extension. Neither `onInstalled` nor
`onStartup` fires; only the service worker restarts.

Put state synchronisation at **module top level**, not only in lifecycle listeners:

```js
syncState();                                   // runs on every SW wake
chrome.runtime.onInstalled.addListener(syncState);
chrome.runtime.onStartup.addListener(syncState);
```

Related: that permission is **outside** the Permissions API. `chrome.permissions.request({ origins: ['file:///*'] })` cannot grant it. An extension can only *read* the state via
`chrome.extension.isAllowedFileSchemeAccess()` and guide the user to the toggle.

---

## 10. An extension cannot pin itself

There is no pin method on `chrome.action` and no manifest key for it. The toolbar
belongs to the user. `chrome.action.getUserSettings()` (Chrome 91+) reads the state, so
onboarding can detect the moment the user pins it — but nothing more.

The only exception is the `ExtensionSettings` enterprise policy (`toolbar_pin`), which
is an administrator's setting.

---

## 11. `tabs.query`'s url filter costs a scary permission

Filtering by `url` requires the `tabs` permission, which shows *"Read your browsing
history"* at install. For a small utility that warning is expensive.

If you only need to find your own page again, store its tab id instead:

```js
const { myTabId } = await chrome.storage.local.get('myTabId');
try { await chrome.tabs.get(myTabId); } catch { /* closed — open a new one */ }
```

---

## 12. Top-level `await` is unreliable in a module service worker

```js
await init();     // ✗ risky in background.js with "type": "module"
init();           // ✓ fire and forget; accept that early events may race
```

---

## 13. The Errors list never clears itself

`chrome://extensions` keeps errors until *Clear all* is pressed. A stale error will be
read as a new one — and the code snippet shown is fetched from the **current** file, so
line numbers drift and the highlighted line may be a comment.

Log a build stamp on every service-worker start so any report can be dated:

```js
console.log(`[ext] service worker started — v${chrome.runtime.getManifest().version}`);
```

---

## 14. `::highlight()` accepts paint properties only

The CSS Custom Highlight API can style ranges without touching the DOM, but only with
properties that do not affect layout:

| Allowed | Not allowed |
|---|---|
| `color`, `background-color` | `font-weight` |
| `text-decoration` | `font-size` |
| `text-shadow` | `padding`, `margin` |
| `-webkit-text-stroke` | anything causing reflow |

`font-weight` is excluded because it would force reflow. Faux-bold via
`-webkit-text-stroke` is possible but does not always look right.

The upside is large: a range can belong to several highlights at once, so
`background-color` from one and `text-decoration` from another combine cleanly, and the
page DOM is never modified.

---

## 15. Optional permissions keep the install silent

Declaring `*://*/*` in `host_permissions` shows *"Read and change all your data on all
websites"* at install time and pushes Web Store review onto the manual track.

```json
{
  "host_permissions": ["file:///*"],
  "optional_host_permissions": ["*://*/*"]
}
```

Requested from a user gesture instead, installation shows no warning at all:

```js
button.addEventListener('click', async () => {
  const granted = await chrome.permissions.request({ origins: ['*://*/*'] });
});
```

Two things to know: the pattern must match the manifest **exactly**, and
`registerContentScripts` only applies to *subsequent* page loads — inject into the
current tab yourself if you want an immediate effect.

---

## Closing

The common thread is that MV3 rarely tells you when you are wrong. The registration
that never happened, the permission that never reached the matches list, the icon path
that never resolved — none of them raised an error.

The practical defence is not more care. It is **measuring the running extension**
instead of trusting that the code looks correct: a state dump you can call from the
console, a build stamp in the logs, and a check that fails the build when a translation
file is malformed.

---

*These notes were collected while building
[Doc Highlighter](https://github.com/cansuk/doc-highlighter), a GPL-3.0 extension for
highlighting local `.md` / `.html` files and the web.*

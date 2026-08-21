# Why there is an onboarding page

Chrome blocks extensions from reading `file://` pages by default, and that setting sits
**outside the Permissions API**:

```js
chrome.permissions.request({ origins: ['file:///*'] })  // ❌ does NOT grant it
```

The toggle can only be turned on by the user, on `chrome://extensions`. Reading local
documentation files is the reason this extension exists, so the one setting it cannot
ask for is the one it needs most.

There are exactly three things an extension can do about that, and all three are done:

| Capability | How |
|---|---|
| **Detect** | `chrome.extension.isAllowedFileSchemeAccess()` |
| **Direct** | `chrome.tabs.create({ url: 'chrome://extensions/?id=' + chrome.runtime.id })` |
| **Verify** | polling from the moment the toggle flips, plus a liveness message from the content script |

`chrome://` addresses cannot be opened from an `<a href>` — Chrome blocks it.
`chrome.tabs.create` is the only way.

## The flow

1. **Install** → `runtime.onInstalled` fires with `reason === 'install'`; if the
   permission is off, the onboarding tab is opened.
2. The user presses **Open extension settings** → the details page opens.
3. The user turns on **Allow access to file URLs**.
   → Chrome reloads the extension; the onboarding tab may refresh. **This is normal.**
4. The onboarding page re-reads the state once a second, and again on
   `visibilitychange` and `focus` → it turns green.
5. When the user opens any local file, the content script sends a `content-alive`
   message → the **live verification** box on the onboarding page fills in.

Step 5 is the one that matters. Steps 1–4 prove a setting was changed; only step 5
proves the content script actually reached a `file://` page.

## Keeping the state correct if the permission is turned off later

- `syncFileAccess()` is called at the **top level** of the service worker. Flipping the
  toggle restarts the extension, but neither `onInstalled` nor `onStartup` fires — so a
  lifecycle listener alone would never notice. See
  [field note 9](mv3-field-notes.md).
- While the permission is off the toolbar icon switches to the muted grey variant and a
  red `!` badge is set.
- The popup checks live every time it opens, and offers a one-click route to the
  settings page.

**Known limit:** the icon and badge only update while the service worker is awake. If
the toggle is turned off, the icon can stay yellow until the worker next wakes. The
popup is always live and always right.

## Why the extension cannot pin itself either

The toolbar belongs to the user: there is no pin method on `chrome.action` and no
manifest key for it. `chrome.action.getUserSettings()` (Chrome 91+) can *read* whether
the user has pinned it, which is enough for onboarding to notice the moment they do —
and nothing more. See [field note 10](mv3-field-notes.md).

This matters for testing: the state indicator is the **toolbar** icon, and it is not
visible at all until the extension is pinned.

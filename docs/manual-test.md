# Manual test — step by step

This protocol verifies **installation and the permission flow**, not highlighting
itself. Highlighting is covered by the engine tests (`npm test`) and by the Usage
section of the [README](../README.md); the steps here are its precondition.

Every step says **what you should see**. If you cannot see it, that step is a FAIL —
do not carry on and assume it passed.

---

## 0. Preparation

```bash
npm install        # sharp, first time only
npm run icons      # produces extension/icons/*.png
```

Chrome fails to load the extension if the icons are missing.

Fixtures are in the repo:

```
test-pages/sample.html
test-pages/sample.md
```

## 1. Load the extension

1. Open `chrome://extensions`
2. Top right: **Developer mode** → on
3. **Load unpacked** → select the **`extension/`** folder (not the repo root)

| ✅ Expected | ❌ Problem |
|---|---|
| The card shows the extension name and the **yellow highlighter icon** (the name is localised if Chrome's UI language is Turkish) | A generic puzzle icon → `npm run icons` was not run |
| The **onboarding tab opens by itself** | If it does not: card → **Service worker** → Inspect → read the console |
| No red **Errors** button on the card | If there is one, open it and read the error |

## 2. Pin the extension to the toolbar — this step cannot be skipped

Click the **puzzle piece** in the toolbar → find **Notestark** → click the **pin**.
The icon now sits to the right of the address bar.

> ### ⚠️ There are two icons — do not confuse them
>
> | Where | Source | Changes with state? |
> |---|---|---|
> | The icon on the `chrome://extensions` **card** | `manifest.json` → `icons` | ❌ **No — always yellow.** It is the static package icon |
> | The icon in the **toolbar** | `action.default_icon`, then `chrome.action.setIcon()` at runtime | ✅ Yes — grey while the permission is off |
>
> `setIcon()` changes the toolbar icon only. A yellow card on the extensions page is
> **normal, not a bug**. Use the **toolbar icon** as the state indicator, nothing else.
> See [field note 2](mv3-field-notes.md).

## 3. Permission OFF — icon and badge

> **Turn the permission off first.** Chrome remembers this per extension ID; if it is
> already on you cannot see the grey state. `chrome://extensions` → Notestark →
> **Details** → **Allow access to file URLs** → off.
>
> Verify: card → **service worker** → console →
> ```js
> await self.docHL.debug()
> ```
> `fileAccess` must be **`false`**. If it is `true`, the toggle is still on.

Then just look:

| Where to look | ✅ Expected |
|---|---|
| The **toolbar** icon (the one you pinned) | **Grey**, with a small red **`!`** badge |
| The onboarding page | Yellow box: *"File access is off"* |
| The popup (click the toolbar icon) | *"File access is off"* plus an **Enable** button |

> If the toolbar icon is not grey, `setIcon()` failed — card → **Service worker** →
> **Inspect** → console. (The yellow card icon on the extensions page is not part of
> this check; see the warning above.)

## 4. Turn the permission on

1. On the onboarding page press **Open extension settings** — the extension's details
   page should open in a new tab
2. Turn on **Allow access to file URLs**

| ✅ Expected |
|---|
| Chrome reloads the extension — **the onboarding tab may refresh, this is normal** |
| Back on the onboarding tab it turns green **within a second**: *"File access is on"* |
| The toolbar icon turns **yellow** and the `!` badge disappears |
| The steps section fades out |

> If it does not turn green, press **Check now** on the page. If that does not help
> either, `isAllowedFileSchemeAccess()` is returning false — check whether the toggle
> really is on.

## 5. `.html` test

Paste into the address bar (adjust the path to your clone):

```
file:///<repo>/test-pages/sample.html
```

| ✅ Expected | Where you see it |
|---|---|
| The page opens and is styled | — |
| `[Notestark] content script loaded: file:///... (text/html)` in the console | **F12 → Console** |
| The **Live verification** box on the onboarding tab turns green with a time and a URL | the onboarding tab |

The third line is the actual proof: the content script really did enter a `file://`
page.

## 6. `.md` test — pay attention here

```
file:///<repo>/test-pages/sample.md
```

**Two outcomes are possible and which one you get decides the product's direction:**

| Outcome | What you see | What it means |
|---|---|---|
| **A** | The file **opens in the page as plain text** | ✅ Good. The content script runs and highlighting on `.md` is possible |
| **B** | Chrome **downloads** the file and no page opens | ⚠️ The content script never runs — `.md` needs a separate strategy |

Report which one happened. This has not been measured here and should not be guessed:
which MIME type Chrome maps `.md` to has changed between versions. If B happens there
are ways around it, but which one is needed depends on this answer.

If A, repeat the three checks from step 5 here (the log will say `text/plain`).

## 7. Turn the permission back off — regression

`chrome://extensions` → toggle **off** → reload a local file tab.

| ✅ Expected |
|---|
| The page opens but there is **no** content script log in the console |
| The popup says *"File access is off"* |
| The toolbar icon goes grey |

> **Known limit:** the icon and badge are only updated while the service worker is
> awake. After turning the toggle off the icon can stay yellow for a while — that is
> **known behaviour, not a bug**. Opening the popup wakes the worker and corrects the
> icon. The popup always shows the live, correct value.

Turn the toggle back on when you are done.

## 8. Popup check

Click the icon and try three states:

| Open tab | Expected bottom line |
|---|---|
| `file://.../sample.html` | *"This tab is a local file — the extension is active here."* |
| Any website | *"This tab is not a local file."* |
| A local file with the permission off | *"…cannot be reached because the permission is off."* |

---

## Debugging — where to look

| What is not working | Where to look |
|---|---|
| The extension will not load at all | `chrome://extensions` → **Errors** on the card |
| Onboarding does not open, no badge | Card → **Service worker** → **Inspect** → console |
| The content script is not running | **F12 → Console** on the page itself |
| The popup is blank or broken | Right-click the popup → **Inspect** |
| You changed code and nothing happened | Press **↻ reload** on the card, then reload the tab |

## How to report the result

Write it by step number — which passed, which failed. In particular:

- **Step 6: A or B?**
- In steps 3 and 4, did the **toolbar** icon actually change colour?
- Any errors in the service worker console?

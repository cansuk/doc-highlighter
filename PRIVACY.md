<!-- Generated from site/privacy.html by tools/build-privacy-md.mjs. Do not edit. -->

# Privacy Policy

Last updated: 19 August 2026

**Notestark collects nothing and transmits nothing.** There is no account, no sign-in, no analytics and no third party. Nothing you read, select or write is sent anywhere.

Everything you mark stays on the computer you marked it on.

## What the extension stores

To bring your highlights back when you reopen a document, the extension has to remember where they were. For each highlight it saves, **on your device only**:

| Stored | Why it is needed |
|---|---|
| The text you selected | To find the same passage again after the page reloads |
| About 32 characters before and after it | To find the passage again even if the document is edited and it moves |
| Its position in the document | Checked first, because it is the cheapest way to relocate a mark |
| The colour and underline you chose | To draw the mark the way you left it |
| The document address and title | To know which document a set of marks belongs to |
| A fingerprint of the document text | So renaming or moving a local file does not lose its marks |

Being direct about the first row: **the passages you highlight are excerpts of the page you are reading, and they are saved.** That is unavoidable for a highlighter — but they are saved locally and nowhere else.

## Where it is stored

In `chrome.storage.local`, an area that belongs to the extension on your own machine. Two deliberate choices sit behind that:

- **Not in cookies.** Cookies are attached to requests and sent to servers. Your highlights never are.
- **Not in the page's own storage.** If they lived there, the website could read them and could erase them.

It is *local* storage, not Chrome's sync storage, so your marks are not copied to your Google account and do not travel to your other devices.

## Translation, and the one thing that is downloaded

Translation is optional and runs **on your device**, using the translator built into Chrome. The passage you translate is not sent to a translation service, to us, or to anyone else.

Being precise rather than flattering: the first time you use a language pair, **Chrome downloads a language model**. That download is made by Chrome, not by this extension, and it carries no page text — it fetches the model, nothing about what you are reading. After it, translation works with no network at all.

If you never press the translate button, no model is ever downloaded.

## What is never collected

- No browsing history, and no list of the sites you visit
- No personally identifying information — no name, email, or account of any kind
- No passwords, form input, or anything you type into a page
- No analytics, telemetry, usage statistics, crash reports or fingerprinting
- No advertising identifiers, and nothing is sold or shared with anyone

## Permissions, and what each is for

| Permission | Used for |
|---|---|
| `storage` | Keeping your highlights on the device |
| `activeTab` | Reading the current tab's address, only to tell you whether highlighting is available there |
| `scripting` | Turning the highlighter on for a site after you have enabled it |
| `file:///*` | The main purpose: local `.md` and `.html` files. Chrome keeps this behind its own switch, which only you can turn on |
| `*://*/*` *(optional)* | Websites. Never requested at install — only when you press the button in the popup, and revocable the same way |

## You stay in control

- Pressing the same colour or underline again removes it.
- One button clears every highlight on the page, behind a confirmation step.
- Website access can be withdrawn at any time from the extension's popup, or from `chrome://extensions`.
- **Uninstalling the extension deletes everything it stored.** Chrome removes the extension's storage area with it; nothing is left behind, because there was never a copy anywhere else.

## Children

The extension is not directed at children and collects no information from anyone, including children.

## Changes to this policy

If this policy ever changes, the date at the top changes with it. Should a future version of the extension ever need to send anything anywhere, it would be described here first, and it would be optional.

## Contact

Questions about this policy, or about what the extension does, can be raised on the public issue tracker:

[https://github.com/cansuk/notestark/issues](https://github.com/cansuk/notestark/issues)

---

This policy is also published at the project site. The extension source is public under GPL-3.0, so every statement above can be checked against the code.
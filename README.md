# Doc Highlighter

Highlight and underline text in local `.md` / `.html` files and on the web.
Your marks come back when you reopen the document.

*[Türkçe dokümantasyon → README.tr.md](README.tr.md)*

<!-- SCREENSHOT: docs/screenshot-1.png -->

---

## What it is

A Chrome extension for people who read documentation in the browser and want to
mark it up the way they would mark up paper.

Select text → a small toolbar appears → pick a colour or an underline. The mark is
saved immediately and restored the next time you open that document.

**Six colours, plus underline — and they combine.** A passage can be yellow *and*
underlined.

## What makes it different

**Local first. Nothing leaves your device.**
No account, no sign-in, no server, no network request anywhere in the codebase.
Highlights live in `chrome.storage.local`, which belongs to the extension — not in a
cookie (cookies are sent to the server on every request) and not in the page's
`localStorage` (which the site itself can read and wipe).

**It never touches the page DOM.**
Painting uses the [CSS Custom Highlight API](https://developer.mozilla.org/en-US/docs/Web/API/CSS_Custom_Highlight_API)
instead of wrapping text in `<mark>` elements. The page structure stays exactly as the
site built it: no nested markup when a selection crosses element boundaries, no
collisions with SPA re-renders, and nothing extra lands in text you copy.

**Marks survive the document changing.**
Each highlight stores the exact text plus ~32 characters of context on either side.
When the document shifts, the anchor is relocated by matching that context. If the
text is gone entirely the highlight becomes an *orphan* — it is not deleted, and it
reappears if the text comes back.

**Works inside iframes.**
Some pages render their real content in a cross-origin iframe. Those are supported;
frames with almost no text are skipped so ad and tracking frames cost nothing.

## Install

Not on the Chrome Web Store yet. To run it from source:

1. `git clone https://github.com/cansuk/doc-highlighter`
2. `npm install && npm run icons` — generates the PNG icon set
3. Open `chrome://extensions`, enable **Developer mode**
4. **Load unpacked** → select the **`extension/`** folder (not the repo root)

> The repo root contains `node_modules`, and Chrome refuses to load an unpacked
> extension containing files that start with `_`. Tooling therefore lives outside
> `extension/`. (`_locales` is fine — it is one of Chrome's own reserved names.)

### Enabling it where you need it

| Surface | How |
|---|---|
| **Local files** (`file://`) | `chrome://extensions` → Details → **Allow access to file URLs** |
| **All websites** | Toolbar icon → popup → **Enable on all sites** |
| **One website** | Toolbar icon → popup → **Enable on this site** |

Web access is declared as `optional_host_permissions`, so **installing shows no
permission warning at all**. The permission is requested only when you click the
button, and can be revoked the same way.

`chrome://` pages, the Web Store and other extensions' pages cannot be reached —
Chrome blocks every extension there.

## Usage

| Button | Action |
|---|---|
| 🟡 🟢 🩷 🔵 🟠 🟣 | Apply that colour |
| **U** | Underline |
| **×** | Delete the highlight under the cursor |
| 🧽 | Clear **all** highlights on the page (two-step confirmation) |

Colour and underline are independent — pressing one never clears the other. Pressing
the same thing again removes it; when nothing is left the highlight is deleted.
`Esc` closes the toolbar.

## How it works

```
selection ──▶ text index ──▶ anchor ──▶ chrome.storage.local
                  │            │
                  │            └─ exact + prefix(32) + suffix(32) + offset
                  └─ flattens the DOM to one string, maps offset ⇄ text node

page load ──▶ rebuild index ──▶ resolve anchors ──▶ CSS.highlights.set(...)
```

**Anchoring** follows the shape of the
[W3C Web Annotation](https://www.w3.org/TR/annotation-model/) selectors. Resolution
tries the stored offset first (cheapest), then searches every occurrence of the exact
text and scores candidates by prefix/suffix overlap and proximity to the old position.

**Storage keys** differ by context, because what is stable differs:

```
top page   doc:<normalizedUrl>  → { url, contentHash, title, updatedAt, highlights[] }
           hash:<contentHash>   → <normalizedUrl>     // secondary index: file moved

iframe     doc:#<contentHash>                          // no URL index
```

On a normal page the URL is stable and the content may change. Inside an iframe it is
often the reverse — some hosts put a per-load token in the frame URL — so the content
hash becomes the primary key there. A cross-origin frame cannot read `top.location`,
so the parent URL is not available as a substitute.

**Re-anchoring** runs on a debounced `MutationObserver`, which matters when another
extension or an SPA rewrites the DOM after load.

## Permissions, and why each one exists

| Permission | Why |
|---|---|
| `storage` | Keeps highlights on the device. Nothing is sent anywhere |
| `activeTab` | Reads only the active tab's URL, to show whether highlighting is available there |
| `scripting` | Registers the content script for sites you explicitly enable at runtime |
| `file:///*` | The core use case: local documentation files. Chrome gates this behind its own switch, which the extension cannot flip |
| `*://*/*` *(optional)* | Requested only on your click, never at install time |

## Development

```bash
npm test             # 28 engine tests (jsdom) — no browser required
npm run check:i18n   # locale parity + Chrome message-syntax validation
npm run check:colors # palette contrast + colour-blind separation
npm run icons        # regenerate the icon set
npm run pack         # runs all checks, then builds dist/<name>-<version>.zip
```

Tests execute the **real `content.js`** inside jsdom with `chrome.*` stubs — not a
copy, not a reimplementation. They cover the text index, offset↔range conversion,
cross-element selections, anchor drift, picking the right occurrence of repeated text,
orphan behaviour, URL normalisation, the colour/underline combination, migration of
older records, overlap detection and clearing.

Not covered (needs a real browser): Custom Highlight API rendering, real mouse
selection, `chrome.scripting` registration, permission flows.

Diagnostics are off by default. To turn them on, in the page console:

```js
__docHL.setDebug(true)   // then reload
__docHL.dump()           // always prints: keys, hash, anchor resolution table
```

## Known limits

- **Chrome 105+** required (CSS Custom Highlight API).
- **Bold is on hold.** `font-weight` is not among the properties `::highlight()`
  accepts, because it would force reflow. A faux-bold via `-webkit-text-stroke` was
  tried and rejected. See the `BOLD IS ON HOLD` note in `src/content/content.js`.
- **Weak persistence in some SPAs.** Applications that rewrite the URL via
  `pushState` after load can end up keyed under the pre-navigation URL.
- **Notes, tags and search do not exist yet.**
- **Highlights are sharp-cornered rectangles, by design.** Rounded corners and padding
  would require wrapping the text in a real element — exactly what this engine avoids.
  Measured: `::highlight()` parses `border-radius` and `padding` into the CSSOM and then
  ignores both at paint time. See [field note 14](docs/mv3-field-notes.md).

## Field notes

[**Manifest V3 — Field Notes**](docs/mv3-field-notes.md) collects the things that cost
hours while building this: silent permission filters, deadlocked dynamic script
registration, a translation string that made the extension unloadable, and the two
icons only one of which changes. Every entry was hit in this build and verified in the
browser.

## Roadmap

- Chrome Web Store release
- Safari port — the engine is portable; the permission layer is not
- Notes/tags on a highlight, export to Markdown or JSON

## License

[GPL-3.0](LICENSE) — see [NOTICE](NOTICE) for third-party attributions
(the icons derive from [Lucide](https://lucide.dev), ISC).

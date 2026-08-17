# Chrome Web Store submission — checklist

Live tracking of the listing. Update as fields are filled.

**Item:** Doc Highlighter — Local HTML & Markdown
**Package:** `dist/doc-highlighter-0.8.0.zip` (46.6 KB)
**Category:** Tools

---

## Done

| Field | Source | Note |
|---|---|---|
| Package upload | `dist/doc-highlighter-0.8.0.zip` | ✅ uploaded |
| Category | Tools | ✅ selected |
| Store icon 128×128 | `store/listing-icon-128.png` | ✅ 96×96 artwork + 16px transparent padding, per Google's rule |
| Short description | `store/listing-en.txt` (top block) | 100 / 132 characters |
| Detailed description | `store/listing-en.txt` (bottom block) | 3,167 / 16,000 characters |

---

## Pending

### 1. Localized screenshots — REQUIRED, max 5

Currently produced: **2 of 5**.

| # | File | Shows | Status |
|---|---|---|---|
| 1 | `store/screenshot-2-local.jpg` | Local `.md` open from disk, `file://` visible in the address bar, six colours, underline, colour+underline combined | ✅ 1280×800 |
| 2 | `store/screenshot-1-web.jpg` | The same engine on the web (MDN), inline `code` chips covered edge to edge | ✅ 1280×800 |
| 3 | — | Toolbar close-up: six swatches, underline, eraser, delete — with the active-style ring visible | ⬜ not made |
| 4 | — | Popup: file-access status, per-site and all-sites switches | ⬜ not made |
| 5 | — | Clear-all two-step confirmation, or the onboarding page | ⬜ not made |

Rules: 1280×800 (or 640×400), PNG or JPEG, no rounded corners added by us.

**Note:** 3-5 are optional in the sense that one screenshot satisfies the requirement,
but a listing with a single image looks thin. Aim for at least 3.

**Who can capture what:** frames on `http(s)` pages can be captured through browser
automation. Anything on a `file://` page, the popup, or `chrome://extensions` must be
captured by hand — browser automation cannot reach those surfaces.

### 2. Promo video — optional

The store accepts a **YouTube URL** only; a file cannot be uploaded.

Suggested 30-second cut:
1. A local `.md` open from disk
2. Select a sentence → the toolbar appears
3. Pick a colour → it is applied
4. Add an underline on top of the colour
5. Reload the page → the marks are still there
6. End on the `file://` address bar and the line "nothing leaves your device"

Recording and uploading needs a screen recorder and a YouTube account, so this is a
manual step. Not required for submission — it can be added after publishing.

### 3. Privacy practices tab

Not filled yet. Prepared answers are in `PUBLISHING.md`:

- Single purpose statement
- Justification text for each permission (`storage`, `activeTab`, `scripting`,
  `file:///*`, optional `*://*/*`)
- Data-collection declaration — **"Website content" must be ticked**: selected text is
  stored, on the device only. Nothing is transmitted.
- A privacy policy URL may be requested as a result of that tick — not written yet.

### 4. Turkish listing — optional

`store/listing-tr.txt` is ready. Add Turkish as a language in the dashboard and paste
it. The extension itself already ships English and Turkish, so the listing matching
that is consistent, though not required.

---

## Decided, for the record

- **Not minified.** Minified or obfuscated submissions take longer to review, and the
  package is 46.6 KB — there is nothing to gain.
- **"Open source" is not claimed** in the listing while the repository is private. Add
  it only once the repo is public.
- **Limits are stated in the description on purpose** (Chrome 105+, no notes/tags/
  search, weak persistence in some SPAs). Hiding them produces one-star reviews.

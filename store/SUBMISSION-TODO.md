# Chrome Web Store submission — checklist

Live tracking of the listing. Update as fields are filled.

> **DURUM — 18.08.2026: 0.8.0 incelemeye gönderildi.** Panelde "İncelenmeyi bekliyor".
> Paket inceleme boyunca **kilitli**; "Yeni paket yükle" pasif. Listing alanları
> düzenlenebilir durumda.
>
> **0.8.1 hazır ve bekliyor** (`dist/notestark-0.8.1.zip`, `minimum_chrome_version: 105`).
> Onay geldikten sonra **ilk güncelleme** olarak yüklenecek. Gönderimi iptal edip 0.8.1'i
> koymak kuyruğun sonuna düşürürdü; 0.8.1 sertleştirme olduğu ve Chrome 105 Ağustos
> 2022'de çıktığı için beklemek tercih edildi.

**Item:** Notestark — Local HTML & Markdown
**Package:** `dist/notestark-0.8.1.zip` (46.6 KB) — adds `minimum_chrome_version: 105`
**Category:** Tools

---

## Done

| Field | Source | Note |
|---|---|---|
| Package upload | `dist/notestark-0.8.1.zip` | ⬜ **re-upload needed** — 0.8.0 is the one currently uploaded |
| Category | Tools | ✅ selected |
| Store icon 128×128 | `store/listing-icon-128.png` | ✅ 96×96 artwork + 16px transparent padding, per Google's rule |
| Short description | `store/listing-en.txt` (top block) | 100 / 132 characters |
| Detailed description | `store/listing-en.txt` (bottom block) | 3,167 / 16,000 characters |
| Small promo tile 440×280 | `store/promo-small-440x280.png` | ✅ generated, 24-bit, no alpha |
| Marquee promo tile 1400×560 | `store/promo-marquee-1400x560.png` | ✅ generated, 24-bit, no alpha |

Both tiles are produced by `npm run promo` (`tools/build-promo.mjs`), which asserts
size, channel count and absence of an alpha channel before it exits.

---

## Asset format audit

Measured, not assumed:

| File | Size | Format | Channels | Alpha | Rule |
|---|---|---|---|---|---|
| `screenshot-2-local.jpg` | 1280×800 | JPEG | 3 | no | screenshot |
| `screenshot-1-web.jpg` | 1280×800 | JPEG | 3 | no | screenshot |
| `promo-small-440x280.png` | 440×280 | PNG | 3 | no | small tile |
| `promo-marquee-1400x560.png` | 1400×560 | PNG | 3 | no | marquee tile |
| `listing-icon-128.png` | 128×128 | PNG | 4 | **yes** | store icon |

The store icon is the one asset where alpha is correct — the transparent 16px margin
is what Google asks for. The no-alpha rule applies only to screenshots and promo tiles.

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

### 3.5 Homepage / Support / Privacy policy URLs

Hosted on the author's own domain rather than GitHub, so repo visibility and the store
timeline stay independent. Pages are written and live in `site/`.

| Field | Planned URL |
|---|---|
| Homepage | `/notestark/` → `site/index.html` |
| Privacy policy | `/notestark/privacy` → `site/privacy.html` |
| Support | GitHub Issues, or the contact address on the page |
| Official URL | needs Google Search Console domain verification |

**Blocked:** `multiappsoftwareservices.com` currently serves an expired TLS certificate —
measured 17 Aug 2026: HTTP 301 to HTTPS, then Chrome refuses to render the page. The
privacy policy URL must load cleanly before submission, or review can fail on a link
that has nothing to do with the extension.

Still to fill in `site/`: `CONTACT_EMAIL` (4 places) and `STORE_URL` (1 place).

### 4. Turkish listing — optional

`store/listing-tr.txt` is ready. Add Turkish as a language in the dashboard and paste
it. The extension itself already ships English and Turkish, so the listing matching
that is consistent, though not required.

---

## Decided, for the record

- **Not minified.** Minified or obfuscated submissions take longer to review, and the
  package is 46.6 KB — there is nothing to gain.
- **Repository is public** as of 18 August 2026, GPL-3.0. An OPEN SOURCE section with the
  repo link is now part of both listings.
- **Limits are stated in the description on purpose** (Chrome 105+, no notes/tags/
  search, weak persistence in some SPAs). Hiding them produces one-star reviews.

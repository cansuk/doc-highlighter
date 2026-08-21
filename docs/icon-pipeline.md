# Icon pipeline

```bash
npm run icons     # extension/icons/*.png + store/listing-icon-128.png + assets/*.svg
```

Settings live in `icon.config.json`. The script itself is generic and comes from the
`icon-gen` skill (`~/.claude/skills/icon-gen/`) — other projects use the same script
with a different config.

- **Glyph: Lucide `highlighter`** (ISC — see `NOTICE`). It is downloaded on the first
  run and cached as `assets/glyph-highlighter.svg`, so later runs work offline.
- **Every size is rendered natively at that size.** Producing one 128px PNG and scaling
  it down to 16 blurs the strokes. The script interpolates along a log2 axis using an
  `ANCHORS` table, which enlarges the glyph and thickens the stroke at 16px.
- **Two variants:** `""` (brand yellow `#FFC933`) and `-off` (grey — the state shown
  while the file permission is off).
- **The store listing icon is separate:** 96×96 artwork on a 128×128 canvas with
  transparent padding (`store/listing-icon-128.png`). It is not part of the package; it
  is uploaded to the Web Store form by hand. Alpha is correct in this one file — the
  transparent margin is what Google asks for. It is *not* correct in screenshots or
  promo tiles.
- **Every run writes `assets/_preview.png`**: all sizes side by side, enlarged with
  nearest-neighbour. **Look at that file after any change** — a byte count does not
  prove the icon looks right.

To change the colour, glyph or proportions, edit `icon.config.json` and run
`npm run icons`.

## The trap this pipeline exists next to

`chrome.action.setIcon({ path })` **does not resolve a relative path against the
extension root** — it resolves it against the calling script. `syncFileAccess()` is
called from both `src/background.js` and `src/popup/popup.html`, so `"icons/icon16.png"`
was looked up as `src/icons/…` and `src/popup/icons/…` and failed both times. Always
`chrome.runtime.getURL('icons/icon16.png')`. See
[field note 1](mv3-field-notes.md).

There are also **two icons and only one of them changes** — the card icon on
`chrome://extensions` is static, the toolbar icon is the one `setIcon()` moves. See
[field note 2](mv3-field-notes.md).

/**
 * Builds the Chrome Web Store promo tiles.
 *
 *   store/promo-small-440x280.png    small tile   440x280
 *   store/promo-marquee-1400x560.png marquee tile 1400x560
 *
 * Store rules for both: JPEG or 24-bit PNG, NO alpha channel, exact canvas size,
 * artwork bleeding to the edges (no letterboxing).
 *
 * Text is drawn in two fonts on purpose:
 *   - the product name in the UI font (Segoe UI), width estimated
 *   - document text in Consolas, whose advance is exactly 0.55 * font-size,
 *     so the highlight rectangles behind it can be positioned by arithmetic
 *     instead of by eye.
 */
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'store');

/* Palette — identical to the one shipped in src/content/content.js */
const INK = '#1f2937';
const BRAND = '#ffc933';
const SWATCHES = ['#ffd54a', '#8ee6a8', '#ffa8c5', '#9ecbff', '#ff9c47', '#d9c4ff'];

const MONO = 'Consolas, DejaVu Sans Mono, monospace';
const UI = 'Segoe UI, Arial, Helvetica, sans-serif';

/** Consolas is monospaced: one character always advances 0.55 * font-size. */
const monoW = (chars, size) => chars * 0.55 * size;
/** Segoe UI Bold, measured empirically. Only used for centring, never for hit-boxes. */
const uiBoldW = (text, size) => text.length * 0.52 * size;

/** The Lucide highlighter glyph on a rounded brand tile. */
const iconTile = (x, y, size) => {
  const pad = size * 0.19;
  const inner = size - pad * 2;
  const scale = inner / 24;
  return `
  <rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${size * 0.22}" fill="${BRAND}"/>
  <g transform="translate(${x + pad} ${y + pad}) scale(${scale})"
     fill="none" stroke="${INK}" stroke-width="2.2"
     stroke-linecap="round" stroke-linejoin="round">
    <path d="m9 11-6 6v3h9l3-3"/>
    <path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>
  </g>`;
};

/** A row of palette dots. */
const swatchRow = (cx, cy, r, gap, centred = false) => {
  const span = (SWATCHES.length - 1) * gap;
  const x0 = centred ? cx - span / 2 : cx;
  return SWATCHES.map(
    (c, i) => `<circle cx="${x0 + i * gap}" cy="${cy}" r="${r}" fill="${c}"/>`,
  ).join('');
};

/* ------------------------------------------------------------------ marquee */

/**
 * Document lines shown in the mock card. `marks` are character ranges, which is
 * why this text is monospaced — [from, to) maps to an exact pixel span.
 */
const DOC = [
  { text: 'Content scripts live in an isolated', marks: [{ from: 27, to: 35, color: '#ffd54a' }] },
  { text: 'world. The page cannot see them,', marks: [{ from: 0, to: 6, color: '#ffd54a' }] },
  { text: 'and browser automation cannot', marks: [{ from: 23, to: 29, color: '#ffa8c5' }] },
  {
    text: 'reach them at all. Use postMessage',
    marks: [
      { from: 0, to: 17, color: '#ffa8c5' },
      { from: 23, to: 34, color: '#8ee6a8', underline: true },
    ],
  },
  { text: 'to expose a handle deliberately.', marks: [] },
];

function marqueeSvg() {
  const W = 1400;
  const H = 560;

  /* card geometry */
  const cardX = 748;
  const cardY = 86;
  const cardW = 566;
  const cardH = 388;
  const padX = 34;
  const textX = cardX + padX;
  const size = 23;
  const lead = 40;
  const firstBaseline = cardY + 122;

  const lines = DOC.map((line, i) => {
    const baseline = firstBaseline + i * lead;
    const marks = line.marks
      .map((m) => {
        const x = textX + monoW(m.from, size);
        const w = monoW(m.to - m.from, size);
        const rect = `<rect x="${x}" y="${baseline - size * 0.82}" width="${w}" height="${size * 1.18}" fill="${m.color}"/>`;
        const rule = m.underline
          ? `<rect x="${x}" y="${baseline + size * 0.22}" width="${w}" height="3" fill="${INK}"/>`
          : '';
        return rect + rule;
      })
      .join('');
    const text = `<text x="${textX}" y="${baseline}" font-family="${MONO}" font-size="${size}" fill="${INK}" xml:space="preserve">${line.text}</text>`;
    return marks + text;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <radialGradient id="warm" cx="20%" cy="30%" r="85%">
      <stop offset="0%" stop-color="#2b3a4d"/>
      <stop offset="100%" stop-color="${INK}"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#warm)"/>

  ${iconTile(90, 166, 112)}

  <text x="90" y="360" font-family="${UI}" font-size="68" font-weight="700" fill="#ffffff">Doc Highlighter</text>
  <text x="92" y="410" font-family="${UI}" font-size="30" fill="#cbd5e1">Your highlights come back.</text>
  ${swatchRow(103, 462, 13, 40)}

  <rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="18" fill="#ffffff"/>
  <text x="${cardX + padX}" y="${cardY + 52}" font-family="${MONO}" font-size="20" fill="#94a3b8">field-notes.md</text>
  <rect x="${cardX + padX}" y="${cardY + 70}" width="${cardW - padX * 2}" height="1.5" fill="#e5e7eb"/>
  ${lines}
</svg>`;
}

/* ------------------------------------------------------------------- small */

function smallSvg() {
  const W = 440;
  const H = 280;

  const tag = 'highlights that persist';
  const tagSize = 19;
  const tagW = monoW(tag.length, tagSize);
  const tagX = (W - tagW) / 2;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <radialGradient id="warm" cx="50%" cy="22%" r="90%">
      <stop offset="0%" stop-color="#2b3a4d"/>
      <stop offset="100%" stop-color="${INK}"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#warm)"/>

  ${iconTile((W - 82) / 2, 40, 82)}

  <text x="${W / 2}" y="176" text-anchor="middle" font-family="${UI}"
        font-size="34" font-weight="700" fill="#ffffff">Doc Highlighter</text>

  <rect x="${tagX - 6}" y="194" width="${tagW + 12}" height="28" fill="${SWATCHES[0]}"/>
  <text x="${tagX}" y="214" font-family="${MONO}" font-size="${tagSize}" fill="${INK}"
        xml:space="preserve">${tag}</text>

  ${swatchRow(W / 2, 250, 7, 26, true)}
</svg>`;
}

/* -------------------------------------------------------------------- build */

/** Store rule: 24-bit, no alpha. Flatten onto the ink background, then assert. */
async function write(svg, file, w, h) {
  const path = join(OUT, file);
  await sharp(Buffer.from(svg))
    .flatten({ background: INK })
    .png({ compressionLevel: 9, palette: false })
    .toFile(path);

  const meta = await sharp(path).metadata();
  const ok = meta.width === w && meta.height === h && meta.channels === 3 && !meta.hasAlpha;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${file}  ${meta.width}x${meta.height}  ` +
      `${meta.channels} channels  alpha=${!!meta.hasAlpha}  ${meta.depth}`,
  );
  if (!ok) process.exitCode = 1;
}

await mkdir(OUT, { recursive: true });
await write(smallSvg(), 'promo-small-440x280.png', 440, 280);
await write(marqueeSvg(), 'promo-marquee-1400x560.png', 1400, 560);

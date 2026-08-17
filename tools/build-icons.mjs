/**
 * icon-gen — config tabanli icon uretimi (SVG -> PNG).
 *
 *   node build-icons.mjs [config.json]     (varsayilan: ./icon.config.json)
 *
 * Tasarim ilkesi: her boyut KENDI boyutunda natively render edilir. Tek bir buyuk
 * PNG uretip kucultmek stroke'lari bulaniklastirir. Kucuk boyutlarda glyph orani
 * buyur ve stroke kalinlasir (ANCHORS tablosu, log2 ekseninde interpolasyon).
 */

import sharp from 'sharp';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

// --- config ----------------------------------------------------------------

const CONFIG_PATH = resolve(process.argv[2] ?? 'icon.config.json');
const ROOT = dirname(CONFIG_PATH);

if (!existsSync(CONFIG_PATH)) {
  console.error(`Config bulunamadi: ${CONFIG_PATH}`);
  process.exit(1);
}

const cfg = JSON.parse(await readFile(CONFIG_PATH, 'utf8'));

const PRESETS = {
  'chrome-extension': [16, 32, 48, 128],
  'firefox-extension': [16, 32, 48, 96, 128],
  'vscode-extension': [128],
  favicon: [16, 32, 48, 180, 192, 512],
  pwa: [192, 512],
  desktop: [16, 32, 64, 128, 256, 512, 1024],
};

const sizes = cfg.sizes ?? PRESETS[cfg.preset];
if (!sizes?.length) {
  console.error(`Gecersiz preset "${cfg.preset}". Secenekler: ${Object.keys(PRESETS).join(', ')}`);
  process.exit(1);
}

const variants = cfg.variants ?? { '': { tile: '#4F46E5', ink: '#FFFFFF' } };
const outDir = resolve(ROOT, cfg.out ?? 'icons');
const assetsDir = resolve(ROOT, cfg.assetsOut ?? 'assets');

// --- glyph cozumleme -------------------------------------------------------

const LUCIDE_RAW = 'https://raw.githubusercontent.com/lucide-icons/lucide/main/icons';

async function resolveGlyph(g) {
  let svg;

  if (g.source === 'lucide') {
    const cache = join(assetsDir, `glyph-${g.name}.svg`);
    if (existsSync(cache)) {
      svg = await readFile(cache, 'utf8');
    } else {
      const res = await fetch(`${LUCIDE_RAW}/${g.name}.svg`);
      if (!res.ok) throw new Error(`Lucide "${g.name}" bulunamadi (HTTP ${res.status})`);
      svg = await res.text();
      await mkdir(assetsDir, { recursive: true });
      await writeFile(cache, svg);
    }
  } else if (g.source === 'file') {
    svg = await readFile(resolve(ROOT, g.path), 'utf8');
  } else if (g.source === 'raw') {
    svg = g.svg;
  } else {
    throw new Error(`glyph.source "lucide" | "file" | "raw" olmali, "${g.source}" verildi`);
  }

  const viewBox = svg.match(/viewBox="([^"]+)"/)?.[1] ?? '0 0 24 24';
  const [, , vbW, vbH] = viewBox.split(/\s+/).map(Number);
  const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>[\s\S]*$/, '').trim();

  // Stroke tabanli mi (Lucide, Feather) yoksa fill tabanli mi (Material) ?
  const strokeMode = /stroke="currentColor"|stroke-width/.test(svg);

  return { inner, vbW, vbH, strokeMode };
}

const glyph = await resolveGlyph(cfg.glyph);

// --- boyuta gore ince ayar --------------------------------------------------
// Olculmus degerler; kucuk boyutta glyph buyur + stroke kalinlasir yoksa cizgi kaybolur.
const ANCHORS = [
  { px: 16, glyphFrac: 0.72, strokeW: 3.1 },
  { px: 32, glyphFrac: 0.68, strokeW: 2.7 },
  { px: 48, glyphFrac: 0.65, strokeW: 2.45 },
  { px: 128, glyphFrac: 0.62, strokeW: 2.2 },
];

const lerp = (a, b, t) => a + (b - a) * t;

function tune(px) {
  const x = Math.log2(px);
  if (x <= Math.log2(ANCHORS[0].px)) return { ...ANCHORS[0] };
  for (let i = 1; i < ANCHORS.length; i++) {
    const x0 = Math.log2(ANCHORS[i - 1].px);
    const x1 = Math.log2(ANCHORS[i].px);
    if (x <= x1) {
      const t = (x - x0) / (x1 - x0);
      return {
        glyphFrac: lerp(ANCHORS[i - 1].glyphFrac, ANCHORS[i].glyphFrac, t),
        strokeW: lerp(ANCHORS[i - 1].strokeW, ANCHORS[i].strokeW, t),
      };
    }
  }
  return { ...ANCHORS.at(-1) };
}

// --- SVG uretimi ------------------------------------------------------------

const D = 100; // tasarim birimi

function tileShape(inset, tile, theme) {
  const shape = cfg.shape ?? 'rounded';
  if (shape === 'none') return '';
  if (shape === 'circle') {
    const c = inset + tile / 2;
    return `<circle cx="${c}" cy="${c}" r="${tile / 2}" fill="${theme.tile}"/>`;
  }
  const r = (tile * (cfg.radiusFrac ?? 0.22)).toFixed(3);
  return `<rect x="${inset}" y="${inset}" width="${tile}" height="${tile}" rx="${r}" fill="${theme.tile}"/>`;
}

function buildSvg({ px, theme, inset = 0, glyphFracOverride, strokeScale = 1 }) {
  const t = tune(px);
  const glyphFrac = glyphFracOverride ?? t.glyphFrac;
  const tile = D - inset * 2;

  // shape:"none" ise tuvalin tamamini kullan, tile padding'i uygulanmaz.
  const box = cfg.shape === 'none' ? D : tile;
  const boxOff = cfg.shape === 'none' ? 0 : inset;

  const span = Math.max(glyph.vbW, glyph.vbH);
  const scale = (box * glyphFrac) / span;
  const gx = (boxOff + (box - glyph.vbW * scale) / 2).toFixed(3);
  const gy = (boxOff + (box - glyph.vbH * scale) / 2).toFixed(3);

  const paint = glyph.strokeMode
    ? `fill="none" stroke="${theme.ink}" stroke-width="${(t.strokeW * strokeScale).toFixed(3)}" stroke-linecap="round" stroke-linejoin="round"`
    : `fill="${theme.ink}" stroke="none"`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${D} ${D}">
  ${tileShape(inset, tile, theme)}
  <g transform="translate(${gx} ${gy}) scale(${scale.toFixed(5)})" ${paint}>
${glyph.inner.split('\n').map((l) => '    ' + l.trim()).join('\n')}
  </g>
</svg>`;
}

async function render(svg, outPath) {
  await mkdir(dirname(outPath), { recursive: true });
  const png = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
  await writeFile(outPath, png);
  return png.length;
}

// --- uretim -----------------------------------------------------------------

const naming = cfg.naming ?? 'icon{size}{variant}.png';
const rows = [];

if (cfg.clean !== false) await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
await mkdir(assetsDir, { recursive: true });

for (const [suffix, theme] of Object.entries(variants)) {
  for (const px of sizes) {
    const name = naming.replace('{size}', String(px)).replace('{variant}', suffix);
    const bytes = await render(buildSvg({ px, theme, strokeScale: cfg.strokeScale ?? 1 }), join(outDir, name));
    rows.push({ file: name, px, variant: suffix || '(normal)', bytes });
  }
}

// Magaza / maskable ikonu: tuvalin bir kismi seffaf padding olarak birakilir.
if (cfg.storeIcon) {
  const s = cfg.storeIcon;
  const theme = variants[s.variant ?? Object.keys(variants)[0]];
  const inset = (D * (1 - (s.artworkFrac ?? 0.75))) / 2;
  const out = resolve(ROOT, s.out);
  const bytes = await render(buildSvg({ px: s.px ?? 128, theme, inset }), out);
  rows.push({ file: s.out, px: s.px ?? 128, variant: 'store/padded', bytes });
}

// Vektor kaynaklari — Figma'ya alinabilir, elle rotuslanabilir.
for (const [suffix, theme] of Object.entries(variants)) {
  const name = `icon${suffix || ''}.svg`;
  await writeFile(join(assetsDir, name), buildSvg({ px: 512, theme }));
}

// --- gorsel dogrulama sayfasi ------------------------------------------------
// Zorunlu adim: sayilar ikonun iyi gorundugunu KANITLAMAZ. Bu sheet buyutulmus
// (nearest-neighbour) hali yan yana koyar; kucuk boyutta bozulma boyle yakalanir.

if (cfg.preview !== false) {
  const previewPath = resolve(ROOT, typeof cfg.preview === 'string' ? cfg.preview : join(assetsDir, '_preview.png'));
  const keys = Object.keys(variants);
  const CELL = 160;
  const GAP = 20;
  const tiles = [];

  for (let r = 0; r < keys.length; r++) {
    for (let c = 0; c < sizes.length; c++) {
      const name = naming.replace('{size}', String(sizes[c])).replace('{variant}', keys[r]);
      tiles.push({
        input: await sharp(join(outDir, name)).resize(CELL, CELL, { kernel: 'nearest' }).toBuffer(),
        left: GAP + c * (CELL + GAP),
        top: GAP + r * (CELL + GAP),
      });
    }
  }

  await mkdir(dirname(previewPath), { recursive: true });
  await sharp({
    create: {
      width: GAP + sizes.length * (CELL + GAP),
      height: GAP + keys.length * (CELL + GAP),
      channels: 4,
      background: '#ffffff',
    },
  })
    .composite(tiles)
    .png()
    .toFile(previewPath);

  console.log(`preview: ${previewPath}   (boyutlar soldan saga: ${sizes.join(', ')})`);
}

console.table(rows);
console.log(`\n${rows.length} PNG uretildi -> ${outDir}`);

/**
 * Palet denetimi — npm run check:colors
 *
 * Highlight renklerini iki olcute gore dogrular:
 *
 *  1. KONTRAST — her renk, uzerine yazilan ink rengiyle WCAG AAA (>= 7:1)
 *     saglamali. Highlight'lanan metin okunabilir kalmali; pastel bir zemin
 *     "guzel gorunuyor" diye yeterli degildir.
 *
 *  2. AYIRT EDILEBILIRLIK — renkler yalnizca HUE ile ayrilmamali. Renk gorme
 *     eksikliginde hue bilgisi kaybolur; geriye luminance kalir. Bu yuzden
 *     ikili luminance farki bir esigin altina dusmemeli.
 *     (Ilk denemede pink #ffa8c5 ile orange #ffb066 luminance'i BIREBIR ayni
 *      cikti — fark 0.000. Orange koyulastirilarak ayrildi.)
 *
 * Renkler content.js'teki PALETTE'ten OKUNUR, burada tekrar yazilmaz. CSS de ayni
 * sabitten uretildigi icin ortada ayrisabilecek ikinci bir kopya yok.
 */

import { readFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'extension', 'src', 'content', 'content.js');

const MIN_CONTRAST = 7.0; // WCAG AAA
const MIN_LUM_GAP = 0.03; // ikili luminance ayrimi

const source = await readFile(SRC, 'utf8');

// Renkler artik CSS'e elle yazilmiyor, PALETTE'ten URETILIYOR. Dolayisiyla
// denetlenecek tek kaynak da PALETTE.
const paletteBlock = source.match(/const PALETTE = \{([\s\S]*?)\};/);
const inkMatch = source.match(/const INK = '(#[0-9a-fA-F]{6})'/);

if (!paletteBlock || !inkMatch) {
  console.error('content.js icinde PALETTE ya da INK bulunamadi — regex bayatlamis olabilir');
  process.exit(1);
}

const ink = inkMatch[1];
const colors = Object.fromEntries(
  [...paletteBlock[1].matchAll(/(\w+):\s*'(#[0-9a-fA-F]{6})'/g)]
    .map((m) => [m[1], m[2]])
    // underline bir zemin rengi degil, cizgi rengi: kontrast/luminance olcutleri
    // ona uygulanmaz.
    .filter(([name]) => name !== 'underline'),
);

if (!Object.keys(colors).length) {
  console.error('PALETTE bos gorunuyor — regex bayatlamis olabilir');
  process.exit(1);
}

const chan = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = (h) => {
  const [r, g, b] = chan(h).map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [l1, l2] = [lum(a), lum(b)];
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

const problems = [];
const rows = Object.entries(colors).map(([name, hex]) => {
  const c = contrast(hex, ink);
  if (c < MIN_CONTRAST) problems.push(`${name} (${hex}) kontrast ${c.toFixed(2)}:1 < ${MIN_CONTRAST}`);
  return { renk: name, hex, luminance: lum(hex).toFixed(3), kontrast: `${c.toFixed(2)}:1` };
});

/*
 * 3. NOT NOKTASI KENDI HIGHLIGHT'I UZERINDE OKUNMALI. Nokta, ait oldugu markin
 *    rengini INK'e dogru karistirarak ciziliyor; tam guclu hali zeminine karisip
 *    kaybolurdu. WCAG 1.4.11 metin disi bir UI bileseni icin 3:1 istiyor.
 */
const MIN_DOT = 3.0;
const mixMatch = source.match(/function inkier\(hex, amount = ([\d.]+)\)/);
if (!mixMatch) {
  console.error('content.js icinde inkier bulunamadi — regex bayatlamis olabilir');
  process.exit(1);
}
const MIX = Number(mixMatch[1]);

const inkier = (hex) => {
  const c = parseInt(hex.slice(1), 16);
  const t = parseInt(ink.slice(1), 16);
  const ch = (sh) => Math.round(((c >> sh) & 255) * (1 - MIX) + ((t >> sh) & 255) * MIX);
  return `#${[16, 8, 0].map((sh) => ch(sh).toString(16).padStart(2, '0')).join('')}`;
};

const dotRows = Object.entries(colors).map(([name, hex]) => {
  const dot = inkier(hex);
  const c = contrast(dot, hex);
  if (c < MIN_DOT) {
    problems.push(`nokta ${name}: ${c.toFixed(2)}:1 < ${MIN_DOT} — kendi highlight'i uzerinde kayboluyor`);
  }
  return { renk: name, highlight: hex, nokta: dot, kontrast: `${c.toFixed(2)}:1` };
});
const names = Object.keys(colors);
let closest = { gap: Infinity, pair: '' };
for (let i = 0; i < names.length; i++) {
  for (let j = i + 1; j < names.length; j++) {
    const gap = Math.abs(lum(colors[names[i]]) - lum(colors[names[j]]));
    if (gap < closest.gap) closest = { gap, pair: `${names[i]} ↔ ${names[j]}` };
    if (gap < MIN_LUM_GAP) {
      problems.push(`${names[i]} ↔ ${names[j]} luminance farki ${gap.toFixed(3)} < ${MIN_LUM_GAP} — renk korlugunde ayirt edilemez`);
    }
  }
}

console.log(`ink: ${ink}  |  renk: ${names.length}  |  kaynak: PALETTE (CSS bundan uretiliyor)`);
console.table(rows);
console.log(`en yakin cift: ${closest.pair} — luminance farki ${closest.gap.toFixed(3)}`);

console.log(`\nnot noktasi (karisim ${MIX}, kendi highlight'i uzerinde):`);
console.table(dotRows);

if (problems.length) {
  console.error(`\n${problems.length} SORUN:`);
  problems.forEach((p) => console.error('  - ' + p));
  process.exit(1);
}
console.log('\npalet saglikli.');

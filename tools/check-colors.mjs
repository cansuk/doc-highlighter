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
 * Renkler content.js'ten OKUNUR, burada tekrar yazilmaz — iki yerde tutulan
 * palet kacinilmaz olarak ayrisir.
 */

import { readFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'extension', 'src', 'content', 'content.js');

const MIN_CONTRAST = 7.0; // WCAG AAA
const MIN_LUM_GAP = 0.03; // ikili luminance ayrimi

const source = await readFile(SRC, 'utf8');

// ::highlight(dh-x) { background-color: #hex; color: #hex; }
const colors = {};
let ink = null;
for (const m of source.matchAll(
  /::highlight\(dh-([a-z]+)\)\s*\{\s*background-color:\s*(#[0-9a-fA-F]{6});\s*color:\s*(#[0-9a-fA-F]{6})/g,
)) {
  colors[m[1]] = m[2];
  ink = m[3];
}

if (!Object.keys(colors).length) {
  console.error('content.js icinde ::highlight kurali bulunamadi — regex bayatlamis olabilir');
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

console.log(`ink: ${ink}  |  renk: ${names.length}`);
console.table(rows);
console.log(`en yakin cift: ${closest.pair} — luminance farki ${closest.gap.toFixed(3)}`);

if (problems.length) {
  console.error(`\n${problems.length} SORUN:`);
  problems.forEach((p) => console.error('  - ' + p));
  process.exit(1);
}
console.log('\npalet saglikli.');

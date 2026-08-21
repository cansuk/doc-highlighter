/**
 * Takes one Chrome Web Store screenshot of a live browser window.
 *
 *   node tools/shot.mjs "*MDN*" 1-web
 *   node tools/shot.mjs "*field-notes*" 2-markdown
 *
 * The store wants exactly 1280x800. The window is sized to 1600x1000 and the
 * image scaled down, because this display runs at 125%: capturing at the larger
 * size and shrinking gives a supersampled result, where capturing at 1280 first
 * would have to upscale Chrome's own rendering.
 *
 * The capture is of the real window, address bar and all. There is no attempt to
 * assemble a browser frame around a page screenshot — the picture on the listing
 * should be the thing itself.
 *
 * The extension has to be arranged on the page first; this only presses the
 * shutter. Chrome 151 refuses --load-extension from the command line, so there is
 * no unattended path to a fresh profile with the extension in it, and driving the
 * browser that is already set up is the honest remaining option.
 */
import { spawn } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'store', 'screenshots');

const W = 1280;
const H = 800;
const GRAB_W = 1600;
const GRAB_H = 1000;

const [titleLike, name] = process.argv.slice(2);
if (!titleLike || !name) {
  console.error('kullanim: node tools/shot.mjs "<pencere basligi kalibi>" <cikti-adi>');
  process.exit(1);
}

await mkdir(OUT, { recursive: true });
const raw = join(OUT, `.raw-${name}.png`);

const ps = spawn(
  'powershell.exe',
  [
    '-NoProfile', '-ExecutionPolicy', 'Bypass',
    '-File', join(ROOT, 'tools', 'capture-window.ps1'),
    '-TitleLike', titleLike,
    '-OutPath', raw,
    '-Width', String(GRAB_W),
    '-Height', String(GRAB_H),
  ],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);

let out = '';
let err = '';
ps.stdout.on('data', (d) => (out += d));
ps.stderr.on('data', (d) => (err += d));
const code = await new Promise((r) => ps.on('close', r));
if (code !== 0) {
  console.error(err.trim() || out.trim());
  process.exit(1);
}

const grabbed = out.trim();
const meta = await sharp(raw).metadata();

// Olculen en-boy orani istenenden sapiyorsa goruntu gerilir; sessizce gerilmis
// bir kare yayinlamaktansa uyarmak yeglenir.
const ratio = meta.width / meta.height;
if (Math.abs(ratio - W / H) > 0.01) {
  console.warn(`uyari: yakalanan oran ${ratio.toFixed(3)}, hedef ${(W / H).toFixed(3)} — goruntu gerilecek`);
}

// flatten: the store takes 24-bit PNG and rejects an alpha channel. A window
// capture carries one even though every pixel is opaque, so it has to be dropped
// explicitly — the upload fails on the channel, not on the pixels.
const target = join(OUT, `${name}.png`);
const info = await sharp(raw)
  .resize(W, H, { fit: 'fill' })
  .flatten({ background: '#ffffff' })
  .png({ compressionLevel: 9 })
  .toFile(target);
await rm(raw, { force: true });

console.log(`${name}.png  ${grabbed} -> ${W}x${H}  ${Math.round(info.size / 1024)} KB`);

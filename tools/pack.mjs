/**
 * Chrome Web Store icin zip uretir — yalnizca extension/ icerigi.
 * node_modules, tools/, assets/, store/ pakete GIRMEZ.
 *
 * Calistirma:  npm run pack   ->  dist/doc-highlighter-<version>.zip
 *
 * Node'un yerlesik zip'i yok; Windows'ta PowerShell Compress-Archive kullaniliyor
 * (ek bir npm bagimliligi eklememek icin).
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, rm, readFile, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'extension');
const DIST = join(ROOT, 'dist');

const manifest = JSON.parse(await readFile(join(SRC, 'manifest.json'), 'utf8'));
const out = join(DIST, `doc-highlighter-${manifest.version}.zip`);

await mkdir(DIST, { recursive: true });
await rm(out, { force: true });

if (process.platform !== 'win32') {
  console.error('Bu script Compress-Archive kullaniyor; win32 disinda `zip -r` kullanin.');
  process.exit(1);
}

// extension/* -> zip kokune (manifest.json zip'in kokunde olmali)
await run('powershell.exe', [
  '-NoProfile',
  '-NonInteractive',
  '-Command',
  `Compress-Archive -Path '${join(SRC, '*')}' -DestinationPath '${out}' -CompressionLevel Optimal -Force`,
]);

const { size } = await stat(out);
console.log(`${out}\n${(size / 1024).toFixed(1)} KB`);

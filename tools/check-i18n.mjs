/**
 * i18n butunluk kontrolu — npm run check:i18n
 *
 * Sessizce bozulan seyleri yakalar:
 *   - locale'ler arasi anahtar kaymasi (birinde var, digerinde yok)
 *   - HTML'deki data-i18n / JS'deki t() anahtari messages.json'da yok
 *   - manifest'teki __MSG_x__ default locale'de yok
 *   - kullanilmayan (olu) anahtar
 *
 * Chrome eksik anahtar icin HATA VERMEZ, bos string dondurur — yani ekran
 * sessizce bosalir. Bu yuzden kontrol build disi bir adim olarak duruyor.
 */

import { readFile, readdir } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { glob } from 'node:fs/promises';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'extension');
const LOCALES_DIR = join(ROOT, '_locales');

const locales = {};
for (const code of await readdir(LOCALES_DIR)) {
  locales[code] = JSON.parse(await readFile(join(LOCALES_DIR, code, 'messages.json'), 'utf8'));
}

const manifest = JSON.parse(await readFile(join(ROOT, 'manifest.json'), 'utf8'));
const base = manifest.default_locale;
const problems = [];

if (!locales[base]) problems.push(`default_locale "${base}" icin _locales/${base}/messages.json yok`);

// 1) locale'ler arasi anahtar kaymasi
const baseKeys = new Set(Object.keys(locales[base] ?? {}));
for (const [code, msgs] of Object.entries(locales)) {
  if (code === base) continue;
  const keys = new Set(Object.keys(msgs));
  for (const k of baseKeys) if (!keys.has(k)) problems.push(`${code}: "${k}" eksik (${base}'de var)`);
  for (const k of keys) if (!baseKeys.has(k)) problems.push(`${code}: "${k}" fazla (${base}'de yok)`);
}

// 1b) MESAJ SOZDIZIMI — $ISIM$ kullanan her mesajda placeholders tanimli olmali
//
// Chrome'da $ISIM$ REZERVE bir sozdizimidir. Tanimsiz birakilirsa manifest
// dogrulamasi
//     "Variable $N$ used but not defined. Could not load manifest."
// hatasiyla basarisiz olur ve EXTENSION HIC YUKLENMEZ — tek bir ceviri
// satiri yuzunden. (17.08.2026'da yasandi.)
//
// Literal dolar isareti icin $$ yazilir; o placeholder sayilmaz.
for (const [code, msgs] of Object.entries(locales)) {
  for (const [key, entry] of Object.entries(msgs)) {
    const text = entry?.message ?? '';
    const declared = new Set(Object.keys(entry?.placeholders ?? {}).map((p) => p.toLowerCase()));

    const used = new Set();
    for (const m of text.replace(/\$\$/g, '').matchAll(/\$([A-Za-z0-9_]+)\$/g)) {
      used.add(m[1].toLowerCase());
    }

    for (const u of used) {
      if (!declared.has(u)) {
        problems.push(`${code}/${key}: mesajda $${u.toUpperCase()}$ var ama placeholders'ta tanimli DEGIL — Chrome manifest'i reddeder`);
      }
    }
    for (const d of declared) {
      if (!used.has(d)) problems.push(`${code}/${key}: placeholder "${d}" tanimli ama mesajda kullanilmiyor`);
    }
  }
}

// 2) kaynakta kullanilan anahtarlar
//
// Iki ayri kume tutuluyor:
//   referenced -> "burada bir i18n anahtari BEKLENIYOR" (eksikse HATA)
//   used       -> "bu anahtar bir yerde geciyor"        (gecmiyorsa yalnizca UYARI)
//
// Ayrim gerekli: anahtar cogu zaman `t(x ? 'aKey' : 'bKey')` gibi ifade icinde
// gecer; cagri kalibini regex'le ayristirmaya calismak false positive uretir
// (denendi, uretti). Kullanim tespiti icin duz string literal taramasi yeterli.
const referenced = new Set();
const used = new Set();

const files = [];
for await (const f of glob('**/*.{html,js}', { cwd: ROOT })) files.push(f);

for (const rel of files) {
  const text = await readFile(join(ROOT, rel), 'utf8');

  if (rel.endsWith('.html')) {
    // HTML attribute'lari kesin referanstir — yanlis yazilirsa ekran bosalir.
    for (const m of text.matchAll(/data-i18n(?:-html|-title)?="([^"]+)"/g)) referenced.add(m[1]);
    for (const m of text.matchAll(/data-i18n-attr="([^"]+)"/g)) {
      for (const pair of m[1].split(',')) {
        const key = pair.split(':')[1]?.trim();
        if (key) referenced.add(key);
      }
    }
  } else {
    // JS: t('literal') / getMessage('literal') kesin referans.
    for (const m of text.matchAll(/(?:\bt|getMessage)\(\s*['"]([A-Za-z0-9_]+)['"]/g)) {
      referenced.add(m[1]);
    }
    // Ifade icindeki anahtarlari yakalamak icin: bilinen anahtara esit her literal.
    for (const m of text.matchAll(/['"]([A-Za-z0-9_]+)['"]/g)) {
      if (baseKeys.has(m[1])) used.add(m[1]);
    }
    // Calisma aninda kurulan anahtarlar:  t('tb' + name)  ya da  msg(`tb${x}`, ...)
    // Onek bir literal oldugu icin yakalanabiliyor; o oneki paylasan her anahtar
    // KULLANILMIS sayilir. Alternatifi bir allowlist olurdu, ama o zaman bir sonraki
    // GERCEKTEN olu anahtar da gorunmez olurdu.
    for (const m of text.matchAll(/['"`]([A-Za-z][A-Za-z0-9_]*)['"`]\s*\+/g)) {
      const prefix = m[1];
      if (prefix.length < 2) continue;
      for (const k of baseKeys) if (k !== prefix && k.startsWith(prefix)) used.add(k);
    }
  }
}

referenced.forEach((k) => used.add(k));

// 3) manifest __MSG_x__ — bunlar da kesin referans
for (const m of JSON.stringify(manifest).matchAll(/__MSG_([A-Za-z0-9_]+)__/g)) {
  referenced.add(m[1]);
  used.add(m[1]);
}

for (const k of referenced) {
  if (!baseKeys.has(k)) problems.push(`referans verilen "${k}" anahtari ${base} locale'de YOK`);
}
const dead = [...baseKeys].filter((k) => !used.has(k));

// --- rapor ------------------------------------------------------------------

console.log(`locale: ${Object.keys(locales).join(', ')}  |  default: ${base}`);
console.log(`anahtar: ${baseKeys.size}  |  referans: ${referenced.size} | kullanilan: ${used.size}  |  taranan dosya: ${files.length}`);

if (dead.length) console.log(`\nUYARI — kullanilmayan anahtar (${dead.length}): ${dead.join(', ')}`);

if (problems.length) {
  console.error(`\n${problems.length} SORUN:`);
  problems.forEach((p) => console.error('  - ' + p));
  process.exit(1);
}
console.log('\ni18n tutarli.');

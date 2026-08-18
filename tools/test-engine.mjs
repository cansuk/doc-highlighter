/**
 * Motor testleri — npm test
 *
 * Neden var: highlight motorunun algoritmik cekirdegi (metin indeksi, offset
 * eslemesi, quote anchoring, ortusme tespiti) tarayiciya BAGLI DEGIL. Bunlari
 * her seferinde Chrome'da elle denemek hem yavas hem guvenilmez — bir regresyon
 * ancak "highlight kayboldu" olarak, gec fark ediliyor.
 *
 * Yaklasim: content.js gercek kaynak dosyasi jsdom icinde, chrome.* stub'lariyla
 * calistiriliyor. Test edilen kod, tarayicida kosan kodun BIREBIR kendisi —
 * kopya ya da yeniden yazim degil.
 *
 * Kapsam DISI (tarayici gerektirir): CSS Custom Highlight API render'i, gercek
 * secim/mouse olaylari, chrome.scripting kaydi, izin akislari.
 */

import { readFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { webcrypto } from 'node:crypto';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'extension', 'src', 'content', 'content.js');

// --- minik test kosucusu ----------------------------------------------------

let pass = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.log(`  FAIL ${name}\n         ${err.message}`);
  }
}

function eq(actual, expected, what = '') {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${what} beklenen ${e}, gelen ${a}`);
}

function truthy(v, what) {
  if (!v) throw new Error(`${what} — dogru olmasi bekleniyordu, gelen: ${JSON.stringify(v)}`);
}

// --- ortam ------------------------------------------------------------------

const HTML = `<!doctype html><html><head><title>Test</title></head><body>
<h1>Baslik</h1>
<p id="p1">Bu paragrafin tamami tek bir metin dugumu icinde duruyor.</p>
<p id="p2">Zor senaryo su: secim <strong>bir elementte baslayip</strong> baska bir
elementte bitiyorsa DOM wrapping ic ice yapilar uretir.</p>
<ul>
  <li id="li1">Birinci madde</li>
  <li id="li2">Ikinci madde</li>
</ul>
<table>
  <tr><td>durum</td><td>Basvurunun mevcut durum bilgisi</td></tr>
  <tr><td>durum</td><td>Odemenin durum kodu</td></tr>
</table>
<script>var ignored = "SCRIPT ICERIGI SAYILMAMALI";</script>
</body></html>`;

/** content.js'i jsdom icinde, chrome stub'lariyla calistirir; __docHL doner. */
async function boot(html = HTML, { url = 'https://ornek.test/sayfa?utm_source=x#bolum' } = {}) {
  const dom = new JSDOM(html, { url, pretendToBeVisual: true, runScripts: 'outside-only' });
  const { window } = dom;

  // jsdom'un crypto'su salt-okunur ve subtle icermiyor — tanimi degistiriyoruz.
  Object.defineProperty(window, 'crypto', { value: webcrypto, configurable: true, writable: true });
  if (!window.CSS) window.CSS = {};
  // Custom Highlight API jsdom'da yok — render disi tutuluyor, stub yeterli.
  const highlights = new Map();
  window.CSS.highlights = {
    set: (k, v) => highlights.set(k, v),
    delete: (k) => highlights.delete(k),
    _map: highlights,
  };
  window.Highlight = class Highlight {
    constructor(...ranges) {
      this.ranges = ranges;
    }
  };

  const store = new Map();
  window.chrome = {
    runtime: {
      id: 'test',
      sendMessage: async () => ({}),
      getManifest: () => ({ version: '0.0.0-test' }),
      getURL: (p) => `chrome-extension://test/${p}`,
    },
    i18n: { getMessage: () => '' },
    storage: {
      local: {
        get: async (k) => {
          if (k === null) return Object.fromEntries(store);
          const keys = Array.isArray(k) ? k : [k];
          const out = {};
          for (const key of keys) if (store.has(key)) out[key] = store.get(key);
          return out;
        },
        set: async (obj) => {
          for (const [k, v] of Object.entries(obj)) store.set(k, v);
        },
        remove: async (k) => {
          for (const key of Array.isArray(k) ? k : [k]) store.delete(key);
        },
      },
      onChanged: { addListener: () => {} },
    },
  };

  const source = await readFile(SRC, 'utf8');
  window.eval(source);

  // init() async; __docHL'in yerlesmesini bekle.
  for (let i = 0; i < 50 && !window.__docHL; i++) await new Promise((r) => setTimeout(r, 10));
  if (!window.__docHL) throw new Error('content.js init olmadi — __docHL yok');

  return { dom, window, api: window.__docHL, store };
}

// --- testler ----------------------------------------------------------------

console.log('\nmotor testleri\n');

const { window, api, store } = await boot();
const doc = window.document;

// 1. metin indeksi
check('indeks script/style icerigini almaz', () => {
  const idx = api.buildIndex();
  if (idx.text.includes('SCRIPT ICERIGI SAYILMAMALI')) throw new Error('script metni indekse girdi');
});

check('indeks gorunur metni icerir', () => {
  const idx = api.buildIndex();
  truthy(idx.text.includes('Bu paragrafin tamami'), 'p1 metni');
  truthy(idx.text.includes('Ikinci madde'), 'li2 metni');
});

// 2. offset <-> range gidis donus
check('tek node icinde range -> offset -> range gidis donusu', () => {
  const idx = api.buildIndex();
  const node = doc.getElementById('p1').firstChild;
  const r = doc.createRange();
  r.setStart(node, 3);
  r.setEnd(node, 13);
  const off = api.rangeToOffsets(idx, r);
  truthy(off, 'offset cozumlendi');
  eq(idx.text.slice(off.start, off.end), node.nodeValue.slice(3, 13), 'metin');

  const back = api.offsetsToRange(idx, off.start, off.end);
  truthy(back, 'range geri uretildi');
  eq(back.toString(), node.nodeValue.slice(3, 13), 'geri donen range metni');
});

check('elementler arasi secim cozumlenir', () => {
  const idx = api.buildIndex();
  const r = doc.createRange();
  r.setStart(doc.getElementById('p2').firstChild, 5);
  r.setEnd(doc.getElementById('li2').firstChild, 6);
  const off = api.rangeToOffsets(idx, r);
  truthy(off, 'cok elementli offset');
  truthy(off.end > off.start, 'end > start');
  const txt = idx.text.slice(off.start, off.end);
  truthy(txt.includes('Birinci madde'), 'arada kalan metin kapsandi');
});

// 3. anchoring
check('anchor degismeyen sayfada ayni yeri bulur', () => {
  const idx = api.buildIndex();
  const start = idx.text.indexOf('Ikinci madde');
  const a = api.makeAnchor(idx, start, start + 12);
  eq(api.resolveAnchor(idx, a), { start, end: start + 12 }, 'cozum');
});

check('anchor metin KAYINCA da bulur (offset degisti)', () => {
  const idx0 = api.buildIndex();
  const start = idx0.text.indexOf('Ikinci madde');
  const a = api.makeAnchor(idx0, start, start + 12);

  // Basa uzun bir paragraf ekle -> tum offset'ler kayar
  const extra = doc.createElement('p');
  extra.textContent = 'X'.repeat(500);
  doc.body.insertBefore(extra, doc.body.firstChild);

  const idx1 = api.buildIndex();
  const hit = api.resolveAnchor(idx1, a);
  truthy(hit, 'kaymis metinde bulundu');
  eq(idx1.text.slice(hit.start, hit.end), 'Ikinci madde', 'bulunan metin');
  if (hit.start === a.start) throw new Error('offset kaymamis — test kurulumu hatali');

  extra.remove();
});

check('tekrar eden metinde DOGRU olani secer (prefix/suffix)', () => {
  const idx = api.buildIndex();
  // "durum" 4 kez geciyor; ikinci satirdaki "Odemenin durum kodu" hedefleniyor
  const target = idx.text.indexOf('Odemenin durum kodu') + 'Odemenin '.length;
  const a = api.makeAnchor(idx, target, target + 5);
  eq(a.exact, 'durum', 'anchor metni');
  const hit = api.resolveAnchor(idx, a);
  eq(hit, { start: target, end: target + 5 }, 'dogru gecis secildi');
});

check('metin silinince ORPHAN doner (veri kaybi degil, null)', () => {
  const idx = api.buildIndex();
  const a = { exact: 'BOYLE BIR METIN YOK', prefix: '', suffix: '', start: 0, end: 19 };
  eq(api.resolveAnchor(idx, a), null, 'orphan');
});

// 4. URL normalizasyonu
check('normalizeUrl utm ve hash temizler', () => {
  const n = api.normalizeUrl('https://a.test/x?utm_source=q&id=7&fbclid=z#bolum');
  truthy(!n.includes('utm_source'), 'utm silindi');
  truthy(!n.includes('fbclid'), 'fbclid silindi');
  truthy(n.includes('id=7'), 'gercek parametre korundu');
  truthy(!n.includes('#'), 'hash silindi');
});

// 5. kalicilik: ekle -> kaydet -> yeniden yukle
{
  const idx = api.buildIndex();
  const node = doc.getElementById('p1').firstChild;
  const r = doc.createRange();
  r.setStart(node, 0);
  r.setEnd(node, 15);
  await api.applyToSelection(r, { color: 'yellow' });

  check('addHighlight state e ekledi', () => {
    eq(api.state.highlights.length, 1, 'highlight sayisi');
    eq(api.state.highlights[0].color, 'yellow', 'renk');
  });

  check('storage anahtari URL bazli (ust sayfa)', () => {
    const keys = [...store.keys()];
    truthy(keys.some((k) => k.startsWith('doc:https://ornek.test/')), `doc: anahtari — gelen: ${keys}`);
    truthy(keys.some((k) => k.startsWith('hash:')), 'hash: index');
  });

  const r2 = doc.createRange();
  r2.setStart(node, 0);
  r2.setEnd(node, 15);
  await api.applyToSelection(r2, { color: 'yellow' });
  check('ayni yeri tekrar ayni stille isaretlemek KALDIRIR (toggle)', () =>
    eq(api.state.highlights.length, 0, 'toggle sonrasi highlight sayisi'));

  const sameRange = () => {
    const r = doc.createRange();
    r.setStart(node, 0);
    r.setEnd(node, 15);
    return r;
  };

  // --- renk + underline BIRLIKTE --------------------------------------------
  await api.applyToSelection(sameRange(), { color: 'yellow' });
  await api.applyToSelection(sameRange(), { underline: true });
  check('underline eklemek rengi SILMEZ — ikisi birlikte', () => {
    eq(api.state.highlights.length, 1, 'mukerrer kayit yok');
    eq(api.state.highlights[0].color, 'yellow', 'renk korundu');
    eq(api.state.highlights[0].underline, true, 'underline eklendi');
  });

  await api.applyToSelection(sameRange(), { color: 'blue' });
  check('renk degistirmek underline i SILMEZ', () => {
    eq(api.state.highlights[0].color, 'blue', 'renk');
    eq(api.state.highlights[0].underline, true, 'underline duruyor');
  });

  await api.applyToSelection(sameRange(), { underline: true });
  check('underline tekrar -> yalnizca underline kalkar, renk kalir', () => {
    eq(api.state.highlights[0].color, 'blue', 'renk duruyor');
    eq(api.state.highlights[0].underline, false, 'underline kalkti');
  });

  await api.applyToSelection(sameRange(), { color: 'blue' });
  check('son stil de kalkinca highlight SILINIR', () => eq(api.state.highlights.length, 0, 'sayi'));

  // paint icin bir highlight birak
  await api.applyToSelection(sameRange(), { color: 'green' });
}

// 5b. eski kayitlarin gecisi (migrate)
check('migrate: eski style:"yellow" -> color:yellow, underline:false', () => {
  const m = api.migrate({ id: 'x', style: 'yellow', anchor: {} });
  eq(m.color, 'yellow', 'renk');
  eq(m.underline, false, 'underline');
  eq(m.style, undefined, 'eski alan temizlendi');
});

check('migrate: eski style:"underline" -> color:null, underline:true', () => {
  const m = api.migrate({ id: 'x', style: 'underline', anchor: {} });
  eq(m.color, null, 'renk yok');
  eq(m.underline, true, 'underline');
});

check('migrate: bilinmeyen stil (bold) veri olarak KORUNUR', () => {
  const m = api.migrate({ id: 'x', style: 'bold', anchor: {} });
  eq(m.color, 'bold', 'deger silinmedi');
});

check('migrate idempotent — yeni modeli bozmaz', () => {
  const src = { id: 'x', color: 'pink', underline: true, anchor: {} };
  eq(api.migrate(src), src, 'ayni kaldi');
});

// 5c. "tumunu temizle" — sayfadaki her sey gider, storage anahtarlari da silinir
{
  const node = doc.getElementById('p1').firstChild;
  const mk = (a, b) => {
    const r = doc.createRange();
    r.setStart(node, a);
    r.setEnd(node, b);
    return r;
  };

  await api.applyToSelection(mk(0, 10), { color: 'yellow' });
  await api.applyToSelection(mk(20, 32), { color: 'pink', underline: true });

  check('temizlik oncesi: 2 highlight + storage kaydi var', () => {
    eq(api.state.highlights.length, 2, 'sayi');
    truthy([...store.keys()].some((k) => k.startsWith('doc:')), 'doc: kaydi');
  });

  const removed = await api.clearPage();

  check('clearPage tum highlight lari sildi', () => {
    eq(removed, 2, 'silinen sayi');
    eq(api.state.highlights.length, 0, 'kalan');
  });

  check('clearPage storage ANAHTARLARINI da sildi (bos kayit birakmaz)', () => {
    const left = [...store.keys()].filter((k) => k.startsWith('doc:') || k.startsWith('hash:'));
    eq(left, [], `artik kayit kalmamali — kalan: ${left}`);
  });

  // sonraki testler icin bir highlight birak
  await api.applyToSelection(mk(0, 15), { color: 'green' });
}

// 6. ortusme esigi
check('kismi ortusen secim ayni highlight sayilir (%75)', () => {
  const idx = api.buildIndex();
  const h = api.state.highlights[0];
  const hit = api.resolveAnchor(idx, h.anchor);
  truthy(hit, 'mevcut highlight cozuldu');
  api.applyAll(idx);
  // 2 karakter kaydirilmis, buyuk olcude ortusen bir aralik
  const found = api.findOverlapping(hit.start + 2, hit.end);
  truthy(found, 'ortusme yakalandi');
  eq(found.id, h.id, 'ayni highlight');
});

check('ilgisiz aralik ortusme saymaz', () => {
  const idx = api.buildIndex();
  api.applyAll(idx);
  const far = idx.text.indexOf('Ikinci madde');
  eq(api.findOverlapping(far, far + 12), null, 'ortusme yok');
});

// 7. yeniden yukleme: ayni sayfa yeniden acilinca highlight geri gelmeli
{
  const saved = Object.fromEntries(store);
  const boot2 = await boot(HTML, { url: 'https://ornek.test/sayfa?utm_source=BASKA#x' });
  for (const [k, v] of Object.entries(saved)) await boot2.window.chrome.storage.local.set({ [k]: v });
  // storage'i doldurduktan sonra yeniden yukle
  const idx2 = boot2.api.buildIndex();
  await boot2.api.state && null;
  const rec = saved[Object.keys(saved).find((k) => k.startsWith('doc:'))];

  check('kayit URL i utm den bagimsiz normalize edilmis', () => {
    const docKeys = Object.keys(saved).filter((k) => k.startsWith('doc:'));
    eq(docKeys.length, 1, 'tek doc kaydi');
    truthy(!docKeys[0].includes('utm_source'), `anahtar utm icermemeli: ${docKeys[0]}`);
  });

  check('kaydedilen highlight anchor bilgisi tam', () => {
    truthy(rec.highlights.length > 0, 'highlight var');
    const a = rec.highlights[0].anchor;
    truthy(a.exact && typeof a.start === 'number' && typeof a.end === 'number', 'anchor alanlari');
  });

  check('kaydedilen anchor TEMIZ bir sayfada yeniden cozulur', () => {
    const hit = boot2.api.resolveAnchor(idx2, rec.highlights[0].anchor);
    truthy(hit, 'yeniden cozuldu');
    eq(idx2.text.slice(hit.start, hit.end), rec.highlights[0].anchor.exact, 'metin ayni');
  });
}


// --- navigator paneli: icindekiler cikarimi ---------------------------------
// Neden onemli: lokal bir .md dosyasinda DOM'da BASLIK YOKTUR. Chrome dosyayi
// tek bir <pre> icinde duz metin olarak gosterir. Icindekiler bu yuzden iki
// ayri kaynaktan cikariliyor ve ikisi de burada dogrulanir.

{
  const { api } = await boot();

  check('render edilmis dokumanda basliklar DOM dan gelir', () => {
    const items = api.collectHeadings(api.buildIndex());
    truthy(items.length >= 1, 'en az bir baslik');
    eq(items[0].level, 1, 'seviye');
    eq(items[0].text, 'Baslik', 'metin');
    truthy(items[0].el, 'element referansi tasiyor');
  });

  check('render edilmis dokuman ham metin sayilmaz', () => {
    eq(api.isRawTextDocument(), false, 'isRawTextDocument');
  });
}

{
  // Chrome'un duz metin goruntuleyicisinin urettigi yapi: tek <pre>.
  const MD = [
    '# Manifest V3',
    '',
    'Giris paragrafi.',
    '',
    '## 1. setIcon yolu',
    '',
    'Govde metni burada.',
    '',
    '### Ayrinti',
    '',
    '#hashtag bir baslik DEGILDIR',
    '',
    '###### Alti seviye',
  ].join('\n');

  const { api } = await boot(
    '<!doctype html><html><body><pre>' + MD + '</pre></body></html>',
    { url: 'file:///C:/notlar/mv3.md' },
  );

  check('ham .md dosyasi ham metin olarak taninir', () => {
    eq(api.isRawTextDocument(), true, 'isRawTextDocument');
  });

  check('ham .md dosyasinda basliklar # sozdiziminden cikarilir', () => {
    const items = api.collectHeadings(api.buildIndex());
    eq(items.map((h) => [h.level, h.text]), [
      [1, 'Manifest V3'],
      [2, '1. setIcon yolu'],
      [3, 'Ayrinti'],
      [6, 'Alti seviye'],
    ], 'baslik listesi');
  });

  check('bosluksuz # bir baslik degildir', () => {
    const items = api.collectHeadings(api.buildIndex());
    truthy(!items.some((h) => h.text.includes('hashtag')), '#hashtag alinmadi');
  });

  check('ham .md basligindaki offset gercek metne denk gelir', () => {
    const idx = api.buildIndex();
    const items = api.collectHeadings(idx);
    for (const h of items) {
      eq(idx.text.slice(h.start, h.end), h.text, 'offset -> metin (' + h.text + ')');
    }
  });

  check('ham .md dosyasinda basliklar element referansi TASIMAZ', () => {
    // Element yoksa panel offset uzerinden range kurup oraya atlar; bu ayrim
    // bozulursa tiklama sessizce hicbir sey yapmaz.
    const items = api.collectHeadings(api.buildIndex());
    truthy(items.every((h) => !h.el && typeof h.start === 'number'), 'hepsi offset tabanli');
  });
}

{
  // Kendi arayuzumuzdeki basliklar icindekiler listesine SIZMAMALI.
  const { window, api } = await boot();
  const ui = window.document.createElement('div');
  ui.setAttribute('data-dh-ui', '');
  ui.innerHTML = '<h2>PANEL BASLIGI SIZMAMALI</h2>';
  window.document.body.appendChild(ui);

  check('kendi arayuzumuzun basliklari icindekilere girmez', () => {
    const items = api.collectHeadings(api.buildIndex());
    truthy(!items.some((h) => h.text.includes('SIZMAMALI')), 'UI basligi elendi');
  });
}

// --- sonuc ------------------------------------------------------------------

console.log(`\n${pass} gecti, ${failures.length} kaldi\n`);
if (failures.length) {
  for (const f of failures) console.error(`FAIL ${f.name}\n  ${f.err.stack}\n`);
  process.exit(1);
}

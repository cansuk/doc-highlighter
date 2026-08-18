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
        // Baglanan dinleyiciler saklanir: komut kanalinin gercekten kaydolup
        // kaydolmadigi ancak boyle olculebilir.
        onMessage: {
          listeners: [],
          addListener(fn) {
            this.listeners.push(fn);
          },
        },
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
    { url: 'file:///C:/notlar/mv3.txt' }, // .txt: preview tetiklenmesin, ham yol test ediliyor
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


// --- navigator paneli: sayfa yerlesimi ve temasi ----------------------------
// Bu uc test tarayicida bulunan uc kusurdan dogdu: panel kapali aciliyordu,
// tema yalnizca paneli boyuyordu, ve panel metnin USTUNE biniyordu. Ucu de
// jsdom'da gorunur; testsiz birakilirsa sessizce geri gelirler.

{
  const { window, api } = await boot();
  const layout = () => window.document.getElementById('dh-page-layout');
  const theme = () => window.document.getElementById('dh-page-theme');

  // Her test kendi durumunu BASTAN kurar. Onceki hali durumu iddialardan SONRA
  // geri aliyordu; bir iddia patlayinca temizlik hic calismiyor ve sonraki testler
  // kirli durumla kosuyordu.
  const setup = (o) => {
    api.prefs.open = o.open ?? true;
    api.prefs.side = o.side ?? 'right';
    api.prefs.theme = o.theme ?? 'auto';
    api.syncPanelChrome();
  };

  check('panel varsayilan olarak ACIK gelir', () => {
    eq(api.prefs.open, true, 'prefs.open');
  });

  check('panel acikken sayfayi ORTMEZ, yer acar', () => {
    setup({ open: true, side: 'right' });
    // Sihirli sayi degil ILISKI: rezerve edilen yer panel + handle genisligine
    // esit olmali. Genislik degistiginde beklenti kendiliginden guncellenir, ama
    // bozulan sey iliskinin kendisiyse test yine patlar.
    const beklenen = api.PANEL_W + api.HANDLE_W;
    truthy(layout(), 'yerlesim stili enjekte edildi');
    truthy(
      new RegExp('margin-right:\\s*' + beklenen + 'px').test(layout().textContent),
      'margin-right ' + beklenen + 'px bekleniyordu, gelen: ' + layout().textContent.trim(),
    );
  });

  check('panel kapaliyken sadece handle genisligi rezerve edilir', () => {
    setup({ open: false, side: 'right' });
    truthy(
      new RegExp('margin-right:\\s*' + api.HANDLE_W + 'px').test(layout().textContent),
      'margin-right ' + api.HANDLE_W + 'px bekleniyordu, gelen: ' + layout().textContent.trim(),
    );
  });

  check('panel sola alininca margin da sola gecer', () => {
    setup({ open: true, side: 'left' });
    const css = layout().textContent;
    const beklenen = api.PANEL_W + api.HANDLE_W;
    truthy(
      new RegExp('margin-left:\\s*' + beklenen + 'px').test(css),
      'margin-left ' + beklenen + 'px bekleniyordu, gelen: ' + css.trim(),
    );
    truthy(!/margin-right/.test(css), 'margin-right kalmamali');
  });

  check('tema auto iken sayfaya DOKUNULMAZ', () => {
    setup({ theme: 'auto' });
    eq(theme(), null, 'auto temada sayfa stili olmamali');
  });

  check('tema dark iken TUM SAYFA boyanir, sadece panel degil', () => {
    setup({ theme: 'dark' });
    const css = theme()?.textContent ?? '';
    truthy(/html,\s*body/.test(css), 'html ve body hedefleniyor');
    truthy(css.includes('#161c24'), 'koyu zemin rengi uygulanmis');
  });

  check('tema auto ya donunce sayfa stili KALDIRILIR', () => {
    setup({ theme: 'dark' });
    truthy(theme(), 'once var');
    setup({ theme: 'auto' });
    eq(theme(), null, 'sonra yok');
  });
}


// --- sticky note ------------------------------------------------------------
// Not, ayri bir nesne degil, highlight kaydinin bir ALANI. Bu secimin iki sonucu
// var ve ikisi de burada dogrulaniyor: (1) not eklemek bir mark olusturur,
// (2) rengi olmayan ama notu olan bir mark SILINMEZ.
//
// NOT: check() geri cagrisini await ETMEZ. Async is check DISINDA yapilir, geri
// cagri senkron kalir — aksi halde iddialara hic ulasilmadan test "gecti" sayilir.

{
  const { window, api } = await boot();
  const doc = window.document;
  const p = doc.getElementById('p1');
  const mk = (from, to, patch) => {
    const r = doc.createRange();
    r.setStart(p.firstChild, from);
    r.setEnd(p.firstChild, to);
    return api.applyToSelection(r, patch);
  };

  const noteId = await mk(3, 20, { note: 'bunu test et' });
  const created = api.state.highlights.find((x) => x.id === noteId);

  check('not eklemek renksiz bir mark olusturur', () => {
    truthy(noteId, 'id dondu');
    truthy(created, 'kayit var');
    eq(created.color, null, 'renk yok');
    eq(created.underline, false, 'underline yok');
    eq(created.note, 'bunu test et', 'not metni');
  });

  // patchHighlight rengi/underline i olmayan marklari siler; notun bu kurali
  // degistirmesi gerekiyordu, yoksa mark kaydedilir kaydedilmez yok olurdu.
  const countBefore = api.state.highlights.length;
  await api.patchHighlight(noteId, { note: 'guncellendi' });
  const afterPatch = api.state.highlights.find((x) => x.id === noteId);

  check('notu olan mark renk verilmeden AYAKTA kalir', () => {
    eq(api.state.highlights.length, countBefore, 'kayit sayisi degismedi');
    truthy(afterPatch, 'mark duruyor');
    eq(afterPatch.note, 'guncellendi', 'not guncellendi');
  });

  await api.patchHighlight(noteId, { note: '' });
  const afterClear = api.state.highlights.find((x) => x.id === noteId);

  check('not silinince renksiz mark da gider', () => {
    eq(afterClear, undefined, 'mark kaldirildi');
  });

  const colouredId = await mk(25, 40, { color: 'yellow', note: 'gecici' });
  await api.patchHighlight(colouredId, { note: '' });
  const coloured = api.state.highlights.find((x) => x.id === colouredId);

  check('rengi olan markta not silmek marki KORUR', () => {
    truthy(coloured, 'mark duruyor');
    eq(coloured.color, 'yellow', 'rengi korundu');
    eq(coloured.note, undefined, 'not gitti');
  });

  const saved = await window.chrome.storage.local.get(null);
  const docRec = Object.entries(saved).find(([k]) => k.startsWith('doc:'))?.[1];

  check('mark diske yazilir ve geri okunur', () => {
    truthy(docRec, 'doc kaydi var');
    truthy(docRec.highlights.some((h) => h.color === 'yellow'), 'sari kayit diskte');
  });
}

{
  // Nokta gostergesi YALNIZCA notu olan highlightlarda cikar; her markta ciksa
  // gosterge bilgi degil gurultu olur.
  const { window, api } = await boot();
  const doc = window.document;
  const p = doc.getElementById('p1');
  const mk = (from, to, patch) => {
    const r = doc.createRange();
    r.setStart(p.firstChild, from);
    r.setEnd(p.firstChild, to);
    return api.applyToSelection(r, patch);
  };

  await mk(0, 10, { color: 'green' }); // notsuz
  await mk(15, 25, { note: 'notlu olan' }); // notlu

  check('yalnizca bir mark not tasir', () => {
    eq(api.state.highlights.filter((h) => h.note).length, 1, 'notlu mark sayisi');
    eq(api.state.highlights.length, 2, 'toplam mark');
  });

  // renderNoteDots geometriye dokunur; jsdom'da Range.getClientRects YOK. Bu
  // cagrinin PATLAMAMASI testin kendisidir: bir render yardimcisi applyAll i
  // devirirse sayfadaki TUM highlightlar boyanmaz olur.
  let threw = null;
  try {
    api.renderNoteDots();
  } catch (e) {
    threw = e;
  }

  check('renderNoteDots geometri yokken de PATLAMAZ', () => {
    eq(threw, null, 'istisna firlatmadi');
  });

  check('geometri yokken bile highlightlar cizili kalir', () => {
    eq(api.live.size, 2, 'iki mark hala live');
  });
}


// --- markdown onizleme ------------------------------------------------------
// Bu bolum motorun "DOM a dokunma" kuralini BILEREK kirdigi tek yer, o yuzden
// sonuclari olculuyor: dogru render ediliyor mu, kaynak index e sizmiyor mu,
// geri donulebiliyor mu, ve dosyadan gelen HTML calisabiliyor mu.

const BT = String.fromCharCode(96); // backtick: String.raw icinde yazilamaz
const MD_DOC = [
  '# Manifest V3',
  '',
  'Bir paragraf, icinde ' + BT + 'kod' + BT + ' var.',
  '',
  '## Ikinci baslik',
  '',
  '- birinci madde',
  '- ikinci madde',
  '',
  '| A | B |',
  '|---|---|',
  '| 1 | 2 |',
].join('\n');

{
  const { window, api } = await boot(
    '<!doctype html><html><body><pre>' + MD_DOC + '</pre></body></html>',
    { url: 'file:///C:/notlar/rehber.md' },
  );
  const doc = window.document;

  check('.md dosyasi OTOMATIK render edilir', () => {
    truthy(api.canPreview(), 'canPreview');
    truthy(doc.querySelector('[data-dh-rendered]'), 'render edilmis govde var');
    truthy(doc.querySelector('h1'), 'gercek h1 uretildi');
    truthy(doc.querySelector('table th'), 'tablo uretildi');
    truthy(doc.querySelector('ul li'), 'liste uretildi');
  });

  check('render sonrasi HAM kaynak index e SIZMAZ', () => {
    // display:none yeterli degildi: buildIndex metin dugumlerini gezer, computed
    // style e bakmaz. Kaynak DOM da kalsaydi dokuman index te IKI KEZ bulunurdu ve
    // bir anchor kimsenin goremedigi metne tutunabilirdi.
    const text = api.buildIndex().text;
    truthy(!text.includes('## Ikinci'), 'markdown sozdizimi index te yok');
    truthy(!text.includes('|---|'), 'tablo sozdizimi index te yok');
    eq((text.match(/Manifest V3/g) ?? []).length, 1, 'baslik index te tek kez geciyor');
  });

  check('render sonrasi icindekiler DOM dan gelir', () => {
    const items = api.collectHeadings(api.buildIndex());
    eq(items.map((h) => [h.level, h.text]), [[1, 'Manifest V3'], [2, 'Ikinci baslik']], 'basliklar');
    truthy(items.every((h) => h.el), 'hepsi element referansi tasiyor');
  });
}

{
  const { window, api } = await boot(
    '<!doctype html><html><body><pre>' + MD_DOC + '</pre></body></html>',
    { url: 'file:///C:/notlar/rehber.md' },
  );
  const doc = window.document;

  api.setPreview(false);

  check('onizleme kapatilinca HAM kaynak geri gelir', () => {
    eq(doc.querySelector('[data-dh-rendered]'), null, 'render edilmis govde kaldirildi');
    truthy(doc.querySelector('pre'), 'ham pre geri geldi');
    truthy(api.buildIndex().text.includes('## Ikinci'), 'ham sozdizimi index te');
  });

  api.setPreview(true);

  check('tekrar acilinca yine render edilir', () => {
    truthy(doc.querySelector('[data-dh-rendered]'), 'render edilmis govde var');
    truthy(!api.buildIndex().text.includes('## Ikinci'), 'ham sozdizimi index te degil');
  });
}

{
  // Bir .md dosyasi guvenilmez girdidir: repodan, indirmeden, her yerden gelebilir.
  const { api } = await boot();

  const html = api.renderMarkdown(
    [
      '# <script>alert(1)</script>',
      '',
      '[kotu](javascript:alert(1))',
      '',
      '<img src=x onerror=alert(1)>',
      '',
      'in 5 minutes yazisi koda donmemeli',
    ].join('\n'),
  );

  check('dosyadan gelen HTML calistirilamaz', () => {
    // Olcut "onerror= dizgesi yok" DEGIL. Escape edilince metin olarak duruyor ve
    // olmasi gereken de bu; onemli olan ETIKET KURULAMAMASI. Aci parantezler
    // kacirildigi surece o metin bir attribute e donusemez.
    truthy(!/<script/i.test(html), 'script etiketi kurulamadi');
    truthy(!/<img/i.test(html), 'img etiketi kurulamadi');
    truthy(html.includes('&lt;script&gt;'), 'kacis gercekten uygulanmis');
    truthy(html.includes('&lt;img'), 'img de metin olarak kaldi');
  });

  check('javascript: URL i notrlestirilir', () => {
    truthy(!/href="javascript:/i.test(html), 'javascript: href kalmadi');
    truthy(html.includes('href="#"'), 'zararsiz hedefe dusuruldu');
  });

  check('sayilar yanlislikla kod span i olmaz', () => {
    // Kod yer tutucusu bosluklarla sinirlansaydi "in 5 minutes" koda donerdi.
    truthy(!/<code>5<\/code>/.test(html), '5 koda donmedi');
  });
}


// --- context menu komutlari -------------------------------------------------
// Menunun kendisi service worker'da; secim ve sayfa ise content script'te. Ikisi
// tek bir mesajla birlesiyor, dolayisiyla test edilecek yuzey runCommand.

{
  const { window, api } = await boot();
  const doc = window.document;

  check('komut kanali kaydedildi', () => {
    truthy(window.chrome.runtime.onMessage.listeners.length > 0, 'onMessage dinleyicisi var');
  });

  const select = (from, to) => {
    const p = doc.getElementById('p1');
    const r = doc.createRange();
    r.setStart(p.firstChild, from);
    r.setEnd(p.firstChild, to);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  };

  select(0, 12);
  await api.runCommand('color', 'green');

  check('sag tik ile renk verilir', () => {
    eq(api.state.highlights.length, 1, 'bir mark olustu');
    eq(api.state.highlights[0].color, 'green', 'renk');
  });

  check('komut sonrasi secim birakilir', () => {
    // Secim durursa bir sonraki sag tik ayni pasaji yeniden isaretler.
    eq(window.getSelection().rangeCount, 0, 'secim temizlendi');
  });

  select(20, 32);
  await api.runCommand('underline');

  check('sag tik ile underline verilir', () => {
    eq(api.state.highlights.length, 2, 'ikinci mark');
    eq(api.state.highlights[1].underline, true, 'underline');
  });

  const beforeNote = api.state.highlights.length;
  select(40, 52);
  await api.runCommand('note');

  check('sag tik not editorunu acar ama HENUZ YAZMAZ', () => {
    // Kayit, kaydetme aninda olusur. Onceki tasarim once bos bir mark yaratip
    // sonra dolduruyordu; vazgecen kullanicinin sayfasinda rengi, altcizgisi ve
    // notu olmayan — yani gorunmeyen ve secilemeyen — bir kayit kaliyordu.
    eq(api.state.highlights.length, beforeNote, 'hicbir kayit olusmadi');
  });

  const before = api.prefs.open;
  await api.runCommand('panel');

  check('sag tik paneli acip kapatir', () => {
    eq(api.prefs.open, !before, 'panel durumu tersine dondu');
  });

  await api.runCommand('clear');

  check('sag tik sayfayi temizler', () => {
    eq(api.state.highlights.length, 0, 'hicbir mark kalmadi');
  });

  let threw = null;
  try {
    await api.runCommand('boyle-bir-komut-yok');
  } catch (e) {
    threw = e;
  }

  check('bilinmeyen komut PATLAMAZ', () => {
    // Menu ve content script ayri ayri guncellenebilir; eski bir sekmeye yeni bir
    // komut gelirse sessizce gecilmeli, sayfayi bozmamali.
    eq(threw, null, 'istisna firlatmadi');
  });
}

{
  // Secim yokken secime bagli komutlar hicbir sey yapmamali.
  const { api } = await boot();
  await api.runCommand('color', 'yellow');
  await api.runCommand('underline');
  await api.runCommand('note');

  check('secim yokken hicbir mark olusmaz', () => {
    eq(api.state.highlights.length, 0, 'mark sayisi');
  });
}


// --- ceviri -----------------------------------------------------------------
// jsdom'da Translator API'si YOK, ve bu testin zayifligi degil konusu: eklenti
// Chrome 138 oncesinde, mobilde ve baska tarayicilarda da bu durumda calisiyor.
// Olculen sey, API yokken hicbir seyin bozulmamasi.

{
  const { api } = await boot();

  check('Translator yokken init bozulmaz', () => {
    // Bu blogun boot() edebilmis olmasi zaten kanit; acikca yaziliyor cunku
    // ceviri kodu init icinden cagriliyor ve orada patlarsa TUM eklenti olur.
    truthy(api.state, 'motor ayakta');
    eq(api.hasTranslator(), false, 'API yok olarak raporlaniyor');
  });

  check('hedef dil varsayilani ingilizce', () => {
    eq(api.trPrefs.target, 'en', 'trPrefs.target');
  });

  check('hizli dil listesi hedef dili icerir', () => {
    truthy(api.QUICK_LANGS.includes(api.trPrefs.target), 'liste hedefi kapsiyor');
    truthy(api.QUICK_LANGS.length >= 5, 'anlamli uzunlukta');
  });

  check('dil adlari koddan URETILIR, listeden okunmaz', () => {
    // Proje hicbir yerde dil adi listesi tutmuyor; adlar Intl.DisplayNames'ten
    // geliyor. Bu, ceviri eklendiginde 30 dil adinin iki locale'e elle
    // yazilmasini gerektirmedi.
    const tr = api.langName('tr');
    const ja = api.langName('ja');
    truthy(tr && tr !== 'tr', 'tr icin bir ad uretildi: ' + tr);
    truthy(ja && ja !== 'ja', 'ja icin bir ad uretildi: ' + ja);
  });

  check('bilinmeyen dil kodu koda geri duser', () => {
    const x = api.langName('zzz');
    truthy(typeof x === 'string' && x.length > 0, 'bos donmedi: ' + x);
  });
}

// --- sonuc ------------------------------------------------------------------

console.log(`\n${pass} gecti, ${failures.length} kaldi\n`);
if (failures.length) {
  for (const f of failures) console.error(`FAIL ${f.name}\n  ${f.err.stack}\n`);
  process.exit(1);
}

# Doc Highlighter — Local HTML & Markdown · v0.11.0

Lokal `.md` / `.html` dosyalarında ve izin verdiğin web sitelerinde highlight ve
underline; sekme kapansa da kalıcı.

| Sürüm | Ne geldi |
|---|---|
| **0.10.1** | Panel handle'i markanin sarisiyla ve glow ile cizildi — onceki hali panelin kendi soluk renklerindeydi ve yogun bir sayfada gorunmuyordu. Genislik degisimi rezerve edilen sayfa margin'ine kendiliginden yansidi (ikisi ayni sabiti okuyor) |
| 0.10.0 | **Sticky note** — herhangi bir pasaja not yazilabiliyor. Not ayri bir nesne degil, highlight kaydinin bir alani; boylece anchor sistemi aynen kullaniliyor ve dokuman degisince not da metinle birlikte tasiniyor. Notu olan pasajin sonunda kucuk bir nokta cikiyor, tiklayinca kart aciliyor. Notlar panelin Highlight sekmesinde de gorunuyor |
| 0.9.0 | **Navigator paneli** — sol/sag kenara yaslanan, acilip kapanan panel. Bir sekmede dokuman iskeleti (icindekiler), digerinde tum highlight listesi; tiklayinca o noktaya kayiyor ve kisa sureli bir cerceve ciziliyor. Ham `.md` dosyalarinda basliklar `#` sozdiziminden cikariliyor (DOM'da baslik yok). Acik/koyu tema ve panel tarafi hatirlaniyor |
| 0.8.1 | `minimum_chrome_version: 105` — eski Chrome artık kurulumu reddediyor. Öncesinde kurulabiliyor ama `CSS.highlights` olmadığı için sessizce çalışmıyordu |
| 0.8.0 | **Tümünü temizle** butonu — silgi ikonu, iki adımlı onay. Storage kaydını da siliyor |
| 0.7.0 | **Renk ve underline birlikte verilebiliyor** — ayrı alanlar oldu, eski kayıtlar otomatik geçiyor. Araç çubuğu yarı saydam (arkadaki metin okunuyor) ve aktif stili gösteriyor |
| 0.6.0 | **Altı renk** (mavi, turuncu, mor eklendi) — palet kontrast ve renk körlüğü için ölçüldü. Araç çubuğu artık viewport dışına taşmıyor |
| 0.5.4 | **Tüm sitelerde çalışma gerçekten açıldı** — `*://*/*` izni bir origin filtresi tarafından sessizce eleniyordu. Tarayıcıda uçtan uca doğrulandı |
| 0.5.3 | Tanı köprüsü (postMessage) — otomasyonun content script durumunu okuyabilmesi için |
| 0.5.2 | Kayıt kurtarma zinciri: yarım kalmış kalıcı kayıt çıkmazından çıkış |
| 0.5.1 | Yarış durumu düzeltmesi: `Duplicate script ID` nedeniyle dinamik content script kaydı hiç oluşmuyordu |
| 0.5.0 | **iframe desteği** — içeriği iframe'de olan sayfalar (Claude artifact vb.). Frame'lerde anahtar URL yerine content hash |
| 0.4.0 | **Tüm sitelerde çalışma** — popup'tan tek tıkla. Safari Stage 2 olarak yol haritasına alındı |
| 0.3.0 | Tanı logları kapatıldı (açılabilir), `Extension context invalidated` yakalanıyor, MutationObserver ile yeniden bağlama, depolama şeması URL-birincil oldu |
| 0.2.0 | **Highlight engine** — seçim, renk/underline, kalıcılık, geri yükleme. Web siteleri için `optional_host_permissions` |
| 0.1.0 | İzin (file scheme access) akışı, icon pipeline, i18n |

---

# Kullanım

## Highlight yapma

1. **Metni seç** (fare ile sürükle)
2. Seçimin üstünde küçük bir **araç çubuğu** belirir
3. Bir şeye tıkla:

| Buton | Ne yapar |
|---|---|
| 🟡 🟢 🩷 🔵 🟠 🟣 | O renkle işaretler |
| **U** | Kırmızı **underline** çizer |
| **×** | (Mevcut bir highlight seçiliyken) onu siler |
| 🧽 silgi | **Bu sayfadaki tüm highlight'ları** temizler — iki adımlı onay |

**Renk ve underline bağımsızdır** — bir metin hem sarı hem altı çizili olabilir. Renge
basmak underline'ı, underline'a basmak rengi etkilemez.

**Aynı şeye tekrar basmak onu kaldırır.** Sarı bir highlight'a yine sarı dersen renk
kalkar; underline'a yine underline dersen çizgi kalkar. İkisi de kalmazsa highlight silinir.
Araç çubuğu açıldığında **aktif stiller beyaz halkayla** işaretli görünür.

Bu, hem highlight'a tıklayıp hem metni yeniden seçip yaptığında aynı şekilde çalışır —
aynı yeri ikinci kez işaretlemek mükerrer kayıt üretmez (%75 örtüşme "aynı yer" sayılır).

### Tümünü temizle (silgi)

Araç çubuğundaki **silgi** ikonu, o sayfadaki **tüm** highlight'ları siler. Geri
alınamaz olduğu için **iki adımlıdır**: ilk tıkta buton kırmızıya döner ve
*"12 tanesini sil?"* der; ikinci tıkta uygular. 4 saniye içinde onaylamazsan ya da
başka bir butona basarsan kendiliğinden vazgeçer.

Native `confirm()` **kullanılmıyor** — modal diyalog sayfayı kilitler ve bir content
script'te kötü davranıştır.

Temizlik, storage **anahtarlarını da siler** (boş kayıt bırakmaz).

> **Eski kayıtların ne olacak?** Otomatik geçiyor. Model tek bir `style` alanından
> `{ color, underline }` ikilisine döndü; `load()` sırasında eski kayıtlar dönüştürülüyor.
> Veri kaybı yok, geçiş tekrar tekrar çalıştırılabilir (idempotent). Bilinmeyen bir stil
> (ör. ertelenen `bold`) **silinmiyor** — boyanmıyor ama saklanıyor.

> ### ⏸ Bold ertelendi (11.08.2026)
>
> **B** butonu vardı, **yorum satırına alındı** — sağlıklı çalışmadı, farklı bir çözüm
> düşünülecek.
>
> **Neden zor:** `font-weight` CSS Custom Highlight API'de **desteklenmiyor**.
> `::highlight()` yalnızca boyama özelliklerini kabul eder (`color`, `background-color`,
> `text-decoration`, `text-shadow`, `-webkit-text-stroke`); `font-weight` reflow
> gerektirdiği için spec dışı bırakılmış.
>
> **Denenen:** `-webkit-text-stroke-width: 0.7px` (faux-bold) → istenen sonucu vermedi.
>
> **Değerlendirilecek alternatifler** — detaylı liste `src/content/content.js` içindeki
> *"BOLD ERTELENDI"* notunda: `text-shadow` ile faux-bold, ikisinin düşük değerlerle
> birleşimi, kalınlık yerine kontrastlı bir arka planla vurgu, ya da DOM wrapping
> (`<strong>` — gerçek bold verir ama sayfa yapısını bozduğu için reddedildi).
>
> **Veri kaybı yok:** daha önce `bold` ile kaydedilmiş bir highlight varsa silinmez,
> yalnızca boyanmaz. Bold geri geldiğinde kendiliğinden görünür.

Highlight **anında kaydedilir**. Sayfayı yenile, sekmeyi kapat, tarayıcıyı kapat —
geri geldiğinde yerinde olur.

## Mevcut bir highlight'ı değiştirme / silme

Highlight'ın **üstüne tıkla** (seçim yapmadan). Araç çubuğu açılır:
- Başka bir renge tıkla → rengi değişir
- **×** → silinir

`Esc` araç çubuğunu kapatır.

## Nerede çalışır

| Yüzey | Nasıl açılır |
|---|---|
| **Lokal dosyalar** (`file://`) | `chrome://extensions` → Details → **Allow access to file URLs** (tek seferlik) |
| **Tüm web siteleri** | Popup → **"Tüm sitelerde aç"** (tek seferlik) |
| **Tek bir site** | Popup → **"Bu sitede aç"** — daha dar izin istiyorsan |
| **`chrome://`, Web Store, extension sayfaları** | Çalışmaz — Chrome tüm extension'lara kapatır |

### Neden kurulumda değil de bir butonla

Web izni **isteğe bağlı** (`optional_host_permissions`) tanımlı. Kurulumda **hiçbir
uyarı çıkmaz**; izin ancak sen istediğinde, kendi tıklamanla sorulur.

Alternatif — manifest'e `host_permissions: ["*://*/*"]` yazmak — iki bedel getirirdi:

- Kurulumda **"Tüm web sitelerindeki verilerinizi okuyabilir ve değiştirebilir"** uyarısı
- Chrome Web Store review'ünde **manuel hat** — günler yerine haftalar (bkz. [PUBLISHING.md](PUBLISHING.md))

Bu yüzden izin butona bağlı. Tek tıkla tüm siteler açılıyor, sonuç aynı; maliyeti yok.

**Geri alma:** popup'tan **"Tüm siteleri kapat"**, ya da
`chrome://extensions → Site access`. Tek tek verilmiş site izinleri, "tüm siteler"
kapatılınca **kalkmaz** — Chrome onları ayrı kayıt tutar, her biri kendi satırından
kapatılır.

## Highlight'ım kayboldu, neden?

Sayfa içeriği değişmişse extension highlight'ı **yeniden bağlamaya** çalışır: işaretlediğin
metni ve etrafındaki ~32 karakteri arar. Metin tamamen silinmişse bağlanamaz — bu duruma
**orphan** denir ve konsola yazılır:

```
[Doc Highlighter] N highlight bu sayfada bulunamadı (orphan) — veri silinmedi
```

**Veri silinmez.** Metin geri gelirse highlight da geri gelir.

## Dosyayı taşıdım / adını değiştirdim

Highlight'lar gelir. Kayıt hem **URL** hem **içerik hash'i** ile indeksleniyor; dosya adı
değişse de içerik aynıysa hash üzerinden bulunur.

Tersi de geçerli: URL aynı ama içerik değişmişse kayıt URL indeksinden bulunur ve
highlight'lar yeniden bağlanmaya çalışılır.

## Verim nerede duruyor

`chrome.storage.local` — **extension'a ait** depolama.

- Cookie **değil** (cookie her istekte sunucuya gider, ~4KB sınırı var)
- Sayfanın `localStorage`'ı **değil** (siteler okuyabilir/silebilir, "site verilerini
  temizle" ile uçar)
- Ağa **çıkmaz**, hiçbir sunucuya gönderilmez, hesap gerekmez
- Sekme/tarayıcı kapansa kalır; ~10 MB

Şema:

```
üst sayfa   doc:<normalizedUrl> → { url, contentHash, title, updatedAt, highlights[] }
            hash:<contentHash>  → <normalizedUrl>      // ikinci index (dosya taşındı)

iframe      doc:#<contentHash>  → { ... }              // URL index'i YAZILMAZ
```

**iframe'lerde anahtar neden ters?** Bazı sayfalar içeriği ayrı origin'de bir iframe'de
render ediyor (Claude artifact'ları böyle) ve o frame'in URL'i **her yüklemede değişiyor**:

```
.../?__frame_t=rxKnsYEOTV85xNjkfCgVSbsG.9627765b-...
```

URL birincil anahtar olsaydı highlight'lar her açılışta kaybolur, storage'da her
yüklemeden bir çöp kayıt birikirdi. Frame'de **içerik stabil, URL volatile**; üst sayfada
tam tersi. O yüzden frame'de content hash birincil.

> Üst sayfanın URL'ini frame içinden okuyup kullanmak **mümkün değil** — cross-origin
> frame `top.location`'a erişemez.

Her highlight: `{ id, color: "yellow"|null, underline: bool, anchor: { exact, prefix, suffix, start, end } }`

Silmek için: `chrome://extensions` → Doc Highlighter → **Remove** (extension kaldırılınca
tüm veri gider). Tek tek silmek için highlight'a tıklayıp **×**.

## Bilinmesi gerekenler

- **Chrome 105+** gerekir (CSS Custom Highlight API). Yoksa konsola hata yazılır ve
  hiçbir şey boyanmaz.
- **iframe'ler destekleniyor** (v0.5.0). İçeriği frame'de olan sayfalarda çalışır. 100 karakterden az metni olan frame'ler atlanır (reklam/izleme frame'leri).
- **Sayfanın DOM'una dokunulmaz.** Boyama CSS Custom Highlight API ile yapılır, `<mark>`
  sarmalama yok. Sayfa yapısı bozulmaz, kopyaladığın metne bir şey karışmaz.
- Not/etiket/arama **henüz yok**.
- **SPA'larda kalıcılık zayıf.** Bazı tek-sayfa uygulamaları (ör. `claude.ai`'nin kendi
  arayüzü) yüklendikten sonra URL'i `pushState` ile değiştirir ve içeriği content
  script'ten sonra render eder. Kayıt anahtarı başlangıçtaki URL'e göre belirlendiği için
  highlight yeniden yüklemede bulunamayabilir. Normal sayfalarda ve iframe içeriğinde
  sorun yok — **ölçüldü** (v0.5.4). Çözüm için URL değişimini izleyip anahtarı tazelemek
  gerekir; henüz yapılmadı.

## Yükleme (geliştirme)

`chrome://extensions` → **Geliştirici modu** açık → **Paketlenmemiş öğe yükle** →

```
C:\Projects\workspace\doc-highlighter\extension
```

⚠️ Proje kökünü değil, **`extension/` alt klasörünü** seç. Kök dizinde `node_modules`
var; Chrome, unpacked extension içinde `_` ile başlayan dosya/klasör görürse yüklemeyi
reddeder (`_` sistem için rezerve) — bu yüzden tooling extension'ın dışında duruyor.

> **İstisna:** `_locales` ve `_metadata`, Chrome'un **kendi** rezerve isimleridir ve
> serbesttir. Yasak, bizim uydurduğumuz `_` isimleri içindir. Bu yüzden `extension/_locales`
> sorun çıkarmaz.

---

# Test — adım adım

> Bu bölüm **kurulum ve izin akışını** doğrular — highlight'ın kendisini değil.
> Highlight testi için yukarıdaki **Kullanım** bölümüne bak; buradaki adımlar onun
> ön koşuludur. Her adımda *ne göreceğin* yazıyor — göremiyorsan o adım FAIL'dir.

## 0. Hazırlık

```bash
cd C:\Projects\workspace\doc-highlighter
npm install        # sharp (ilk kez)
npm run icons      # extension/icons/*.png uretir
```

Icon'lar yoksa Chrome yüklemede hata verir. Test dosyaları hazır:

```
C:\Projects\workspace\doc-highlighter\test-pages\sample.html
C:\Projects\workspace\doc-highlighter\test-pages\sample.md
```

## 1. Extension'ı yükle

1. `chrome://extensions` aç
2. Sağ üstte **Geliştirici modu** → açık
3. **Paketlenmemiş öğe yükle** → `C:\Projects\workspace\doc-highlighter\extension`

| ✅ Beklenen | ❌ Sorun |
|---|---|
| Kartta extension adı ve **sarı highlighter ikonu** (Chrome Türkçe ise ad da Türkçe) | Jenerik puzzle ikonu → `npm run icons` koşulmamış |
| **Onboarding sekmesi kendiliğinden açılır** | Açılmazsa: kart → **Service worker** → Inspect → console'a bak |
| Kartta kırmızı **Errors** butonu **yok** | Varsa tıkla, hatayı oku |

## 2. Extension'ı toolbar'a SABİTLE — bu adım atlanamaz

Toolbar'daki **puzzle parçası** simgesine tıkla → listede **Doc Highlighter** → yanındaki
**raptiye** ikonuna bas. Artık ikon adres çubuğunun sağında duruyor.

> ### ⚠️ İki ayrı ikon var, karıştırma
>
> | Nerede | Kaynağı | Duruma göre değişir mi |
> |---|---|---|
> | `chrome://extensions` **kartındaki** ikon | `manifest.json` → `icons` | ❌ **Hayır — her zaman sarı.** Statik paket ikonu |
> | **Toolbar'daki** ikon | `action.default_icon`, runtime'da `chrome.action.setIcon()` | ✅ Evet — izin kapalıyken gri |
>
> `setIcon()` yalnızca toolbar ikonunu değiştirir. Extensions sayfasındaki kartın sarı
> görünmesi **normaldir, bug değildir**. Durum göstergesi olarak **sadece toolbar
> ikonuna** bak.

## 3. İzin KAPALI durumu — ikon ve badge

> **Önce izni KAPAT.** Chrome bu ayarı extension ID başına hatırlar; zaten açıksa gri
> durumu göremezsin. `chrome://extensions` → Doc Highlighter → **Details** →
> **"Dosya URL'lerine erişime izin ver"** → **kapat**.
>
> Doğrula: kart → **service worker** → console →
> ```js
> await self.docHL.debug()
> ```
> `fileAccess` **`false`** olmalı. `true` ise toggle hâlâ açıktır.

Sonra sadece bak:

| Nereye bak | ✅ Beklenen |
|---|---|
| **Toolbar** ikonu (sabitlediğin) | **Gri** + üstünde küçük kırmızı **`!`** rozeti |
| Onboarding sayfası | Sarı kutu: *"Dosya erişimi kapalı"* |
| Popup (toolbar ikonuna tıkla) | *"Dosya erişimi kapalı"* + **İzni aç** butonu |

> Toolbar ikonu gri değilse `setIcon()` başarısız olmuştur — kart → **Service worker** →
> **Inspect** → Console'a bak. (Extensions sayfasındaki sarı kart ikonu bu kontrole
> dahil değil, yukarıdaki uyarıya bak.)

## 4. İzni aç

1. Onboarding sayfasında **Extension ayarlarını aç** butonuna bas
   → yeni sekmede extension'ın detay sayfası açılmalı
2. Sayfada **"Dosya URL'lerine erişime izin ver"** anahtarını **aç**

| ✅ Beklenen |
|---|
| Chrome extension'ı yeniden yükler — **onboarding sekmesi yenilenebilir, normaldir** |
| Onboarding sekmesine dönünce **1 saniye içinde** yeşile döner: *"Dosya erişimi açık"* |
| Toolbar ikonu **sarıya** döner, `!` rozeti kaybolur |
| Adımlar bölümü soluklaşır |

> Yeşile dönmüyorsa: sayfadaki **Şimdi kontrol et** butonuna bas. O da işe yaramıyorsa
> `isAllowedFileSchemeAccess()` false dönüyor demektir — toggle gerçekten açık mı bak.

## 5. `.html` testi

Adres çubuğuna yapıştır:

```
file:///C:/Projects/workspace/doc-highlighter/test-pages/sample.html
```

| ✅ Beklenen | Nerede görülür |
|---|---|
| Sayfa açılır, stilli görünür | — |
| Console'da `[Doc Highlighter] content script yüklendi: file:///... (text/html)` | **F12 → Console** |
| Onboarding sekmesindeki **"Canlı doğrulama"** kutusu yeşile döner, saat + URL yazar | Onboarding sekmesi |

Üçüncü satır asıl kanıttır: content script gerçekten `file://` sayfasına girdi.

## 6. `.md` testi — BURAYA DİKKAT

```
file:///C:/Projects/workspace/doc-highlighter/test-pages/sample.md
```

**İki farklı sonuç mümkün ve hangisi olduğu ürünün yönünü belirler:**

| Sonuç | Ne görünür | Anlamı |
|---|---|---|
| **A** | Dosya **düz metin olarak sayfada açılır** | ✅ İyi haber. Content script çalışır, `.md` üzerinde highlight mümkün |
| **B** | Chrome dosyayı **indirir**, sayfa hiç açılmaz | ⚠️ Content script hiç koşmaz — `.md` için ayrı bir strateji gerekir |

**Hangisinin olduğunu bana söyle.** Bunu ölçmedim, tahmin etmek istemiyorum: Chrome'un
`.md` uzantısını hangi MIME'a eşlediği sürümden sürüme değişti. B çıkarsa çözüm yolları
var ama hangisinin gerektiği bu cevaba bağlı.

A çıkarsa 5. adımdaki üç kontrolün aynısını burada da yap (`text/plain` yazacak).

## 7. İzni geri kapat — regresyon

`chrome://extensions` → toggle'ı **kapat** → bir lokal dosya sekmesini yenile.

| ✅ Beklenen |
|---|
| Sayfa açılır ama console'da content script logu **YOK** |
| Popup'ta *"Dosya erişimi kapalı"* |
| Toolbar ikonu grileşir |

> **Bilinen sınır:** ikon/badge yalnızca service worker uyanıkken güncellenir. Toggle'ı
> kapattıktan sonra ikon bir süre sarı kalabilir — bu **bilinen bir davranış**, bug değil.
> Popup'ı açmak SW'yi uyandırır ve ikonu düzeltir. Popup her zaman canlı doğru değeri gösterir.

Testi bitirince toggle'ı tekrar aç.

## 8. Popup kontrolü

İkona tıkla, üç durumda dene:

| Açık sekme | Beklenen alt satır |
|---|---|
| `file://.../sample.html` | *"Bu sekme lokal bir dosya — extension burada aktif."* |
| Herhangi bir web sitesi | *"Bu sekme lokal bir dosya değil."* |
| İzin kapalıyken lokal dosya | *"...izin kapalı olduğu için erişilemiyor."* |

## Hata ayıklama — nereye bakılır

| Ne çalışmıyor | Nereye bak |
|---|---|
| Extension hiç yüklenmiyor | `chrome://extensions` → kartta **Errors** |
| Onboarding açılmıyor, badge yok | Kart → **Service worker** → **Inspect** → Console |
| Content script çalışmıyor | Sayfada **F12 → Console** (sayfanın kendi console'u) |
| Popup boş/bozuk | Popup'a **sağ tık → İnceleme** |
| Kod değiştirdin, etkisi yok | Kartta **↻ yenile** ikonuna bas, sonra sekmeyi yenile |

## Sonucu nasıl bildir

Adım numarasıyla yaz — hangisi geçti, hangisi kaldı. Özellikle:
- **6. adım A mı B mi?**
- 3. ve 4. adımda TOOLBAR ikonu gerçekten renk değiştirdi mi?
- Service worker console'unda hata var mı?

---

## Neden bir onboarding gerekiyor

Chrome, extension'ların `file://` sayfalarına erişmesini varsayılan olarak kapatır.
Bu ayar **Permissions API'nin dışındadır**:

```js
chrome.permissions.request({ origins: ['file:///*'] })  // ❌ bu izni VERMEZ
```

Toggle yalnızca kullanıcı tarafından `chrome://extensions` üzerinden açılabilir.
Extension'ın yapabileceği üç şey var, üçünü de yapıyoruz:

| Yetenek | Nasıl |
|---|---|
| **Tespit** | `chrome.extension.isAllowedFileSchemeAccess()` |
| **Yönlendirme** | `chrome.tabs.create({ url: 'chrome://extensions/?id=' + chrome.runtime.id })` |
| **Doğrulama** | Toggle açıldığı an polling + content script'ten gelen canlılık mesajı |

`chrome://` adresleri `<a href>` ile açılamaz — Chrome engeller. `chrome.tabs.create`
zorunludur.

## Akış

1. **Kurulum** → `runtime.onInstalled` (`reason === 'install'`) ve izin kapalıysa
   onboarding sekmesi açılır.
2. Kullanıcı **“Extension ayarlarını aç”** butonuna basar → detay sayfası açılır.
3. **“Dosya URL'lerine erişime izin ver”** toggle'ı açılır.
   → Chrome extension'ı yeniden yükler; onboarding sekmesi yenilenebilir, **normaldir**.
4. Onboarding sayfası durumu **1 sn'de bir**, ayrıca `visibilitychange` ve `focus`
   olaylarında yeniden okur → yeşile döner.
5. Kullanıcı herhangi bir lokal dosya açtığında content script `content-alive` mesajı
   gönderir → onboarding'deki **canlı doğrulama** kutusu dolar.

## Durum takibi (izin sonradan kapatılırsa)

- `syncFileAccess()` service worker'ın **top-level'ında** çağrılır. Toggle değişince
  Chrome extension'ı yeniden başlatır ama `onInstalled` / `onStartup` **tetiklenmez** —
  bu yüzden top-level çağrı gerekiyor.
- İzin kapalıysa toolbar ikonu **soluk gri** varyanta döner + kırmızı `!` badge basılır.
- Popup her açılışta canlı kontrol yapar ve tek tıkla ayar sayfasına götürür.

## Icon pipeline

```bash
npm run icons     # extension/icons/*.png + store/listing-icon-128.png + assets/*.svg
```

Ayarlar `icon.config.json` içinde; script generic ve `icon-gen` skill'inden geliyor
(`~/.claude/skills/icon-gen/`). Başka projelerde de aynı script + farklı config.

- Glyph: **Lucide `highlighter`** (ISC — bkz. `NOTICE`). İlk koşumda indirilip
  `assets/glyph-highlighter.svg` olarak cache'lenir; sonraki koşumlar offline çalışır.
- Her boyut **kendi boyutunda natively render edilir**. Tek bir 128px PNG üretip 16'ya
  küçültmek stroke'ları bulanıklaştırır; script `ANCHORS` tablosuyla log2 ekseninde
  interpolasyon yaparak 16px'te glyph'i büyütür, stroke'u kalınlaştırır.
- İki varyant: `""` (sarı `#FFC933`) ve `-off` (gri — izin kapalı durumu).
- **Mağaza listing ikonu ayrıdır:** 128×128 tuvalde 96×96 artwork + şeffaf padding
  (`store/listing-icon-128.png`). Pakete girmez, Web Store formuna elle yüklenir.
- Her koşumda `assets/_preview.png` üretilir: tüm boyutlar nearest-neighbour ile
  büyütülmüş, yan yana. **Değişiklik yaptıysan bu dosyaya bak** — byte sayısı ikonun
  iyi göründüğünü kanıtlamaz.

Renk/glyph/oran değiştirmek için `icon.config.json`'ı düzenle, `npm run icons` koş.

## Testler

```bash
npm test            # 18 motor testi (jsdom) — tarayıcı gerekmez
npm run check:i18n  # locale tutarlılığı
npm run check:colors # palet kontrastı + renk körlüğü ayrımı
npm run pack        # üçünü de koşturur (prepack), sonra zip üretir
```

Testler gerçek `content.js` kaynağını jsdom içinde, `chrome.*` stub'larıyla koşturur —
kopya ya da yeniden yazım değil, **tarayıcıda çalışan kodun birebir kendisi**. Kapsam:
metin indeksi, offset↔range dönüşümü, elementler arası seçim, anchor kayma toleransı,
tekrar eden metinde doğru geçişi seçme, orphan davranışı, URL normalizasyonu, toggle,
%75 örtüşme, kaydet→yeniden çöz.

**Kapsam dışı** (tarayıcı gerektirir): CSS Custom Highlight API render'ı, gerçek fare
seçimi, `chrome.scripting` kaydı, izin akışları. Bunlar elle doğrulanır — v0.5.4'te
uçtan uca doğrulandı: seçim → araç çubuğu → boyama → yeniden yükleme sonrası kalıcılık,
hem normal sayfada hem iframe içeriğinde.

## Tanı log'ları

Varsayılan **kapalı** — konsol temiz. Bilgi log'ları silinmedi, kapatıldı; kalıcılık
hatalarının teşhisi onlarsız mümkün değil.

```js
__docHL.setDebug(true)   // sayfa konsolunda, sonra F5
self.docHL.setDebug(true) // service worker konsolunda
__docHL.dump()           // her zaman yazar, elle çağrılır
```

`console.error` ve kullanıcıyı ilgilendiren uyarılar (ör. "extension yeniden yüklendi,
sayfayı yenile") **her zaman** açık — onlar tanı değil, gerçek arıza.

## Yayınlama

Chrome Web Store adımları, hazır permission justification metinleri, gizlilik beyanı
ve Safari'ye taşıma analizi: **[PUBLISHING.md](PUBLISHING.md)**

## Paketleme

```bash
npm run pack      # dist/doc-highlighter-<version>.zip
```

Yalnızca `extension/` içeriğini zipler (`manifest.json` zip kökünde). `node_modules`,
`tools/`, `assets/`, `store/` pakete girmez. Windows'ta PowerShell `Compress-Archive`
kullanır — ek npm bağımlılığı yok.

## Dizin yapısı

```
doc-highlighter/
  extension/               <- LOAD UNPACKED BURAYI
    _locales/en|tr/         messages.json — ceviriler
    manifest.json
    icons/                 uretilen PNG'ler (npm run icons)
    src/
      background.js        service worker — lifecycle, ikon/badge, mesaj hattı
      shared/access.js     izin okuma/yazma, chrome:// yönlendirme (tek kaynak)
      onboarding/          kurulum sayfası (durum + adımlar + canlı doğrulama)
      popup/               action popup — durum rozeti ve kısa yol
      content/content.js   şimdilik yalnızca canlılık kanıtı; DOM'a dokunmaz
  tools/
    build-icons.mjs        SVG -> PNG uretimi (icon-gen skillinden, config tabanli)
    check-i18n.mjs         locale tutarlilik kontrolu
    pack.mjs               store zip
  icon.config.json         icon ayarlari (preset, glyph, renkler, varyantlar)
  test-pages/              sample.html · sample.md — test fixture'lari
  assets/                  uretilen SVG kaynaklari + glyph cache + _preview.png
  store/                   magaza listing gorselleri
  NOTICE                   ucuncu parti lisanslar (Lucide ISC)
```

## Dil / i18n

**İngilizce + Türkçe, tarayıcı diline göre otomatik.** Chrome'un yerleşik
`chrome.i18n` mekanizması kullanılıyor; ayrı bir dil ayarı yok.

```bash
npm run check:i18n    # locale tutarlılığı — eksik/fazla/ölü anahtar
```

| Dosya | Rol |
|---|---|
| `_locales/en/messages.json` | **default_locale** — `tr` dışındaki her dil bunu görür |
| `_locales/tr/messages.json` | Chrome arayüz dili Türkçe olan kullanıcılar |
| `src/shared/i18n.js` | `t(key)` + `localizeDom()` — DOM'u `data-i18n` attribute'larından doldurur |

**Kullanım:**
- HTML: `data-i18n="key"` → `textContent` · `data-i18n-html="key"` → `innerHTML`
  (mesajda `<code>`/`<strong>` varsa) · `data-i18n-attr="title:key"` → attribute ·
  `<html data-i18n-title="key">` → sayfa başlığı
- JS: `t('key')`, runtime değeri varsa `t('key', [deger])`
- `manifest.json`: `__MSG_extName__` gibi placeholder'lar

**Dil nasıl seçiliyor:** Chrome'un **arayüz dilinden** (`chrome.i18n.getUILanguage()`).
Sayfa dilinden ya da işletim sistemi dilinden değil. Chrome Türkçe ise Türkçe,
başka her şeyde İngilizce.

> **Karar (11.08.2026): dil seçici YOK.** Tarayıcı dili yeterli görüldü; kullanıcıya
> elle dil seçtirilmeyecek. Bu, `chrome.i18n`'i uygun kılan şeydir — zaten desteklenen
> bir runtime override API'si de yok.
>
> Karar değişirse maliyeti: `chrome.i18n` bırakılıp kendi sözlük katmanı yazılır.
> `data-i18n` attribute yapısı ve `localizeDom()` aynı kalır, yalnızca `t()`'nin kaynağı
> `chrome.i18n.getMessage` yerine kendi JSON'umuz olur + seçilen dil `storage.local`'da
> tutulur. Yani ucuz bir geri dönüş — bugün fazladan bir şey yapmaya gerek yok.

**Eksik anahtar sessizce boşluk üretir** — `chrome.i18n.getMessage()` bulunmayan anahtar
için hata vermez, boş string döner. `t()` bu durumda anahtarın kendisini gösterir
(geliştirmede görünür olsun diye) ve `npm run check:i18n` bunu build dışı bir adım
olarak yakalar.

## Öğrenilen tuzaklar (yaşandı, düzeltildi)

**Tek bir çeviri satırı extension'ı hiç yüklenemez hale getirdi.** Chrome'un i18n
şemasında `$İSİM$` **rezerve** bir sözdizimidir: bir mesajda geçiyorsa aynı mesajda bir
`placeholders` bloğu tanımlı olmak zorundadır. Yerine koymayı JS'te yaptığımız için
placeholder tanımlamamıştık; Chrome manifest doğrulamasında
`Variable $N$ used but not defined. Could not load manifest.` deyip **tüm extension'ı
reddetti**. Çözüm: `$...$` sözdiziminden çıkıp `{n}` gibi nötr bir token kullanmak
(literal dolar için `$$` yazılır).
**Ders:** `check:i18n` artık mesaj sözdizimini de denetliyor ve `npm run pack`
üç denetimi birden koşturmadan zip üretmiyor — bozuk bir paket üretilemiyor.

**İzin pattern'i origin filtresinden geçemiyordu.** `grantedWebOrigins()` şöyleydi:
`o.startsWith('http://') || o.startsWith('https://')`. "Tüm siteler" izninin pattern'i
**`*://*/*`** — ikisiyle de başlamıyor, filtre onu **sessizce eliyordu**. Kullanıcı izni
veriyor, Chrome kaydediyor, ama `registerContentScripts` matches listesine hiç girmiyordu:
hiçbir yeni sitede çalışmıyordu ve **hiçbir hata da vermiyordu**.
**Ders:** Chrome'un izin pattern'leri URL değildir — `*://*/*`, `<all_urls>` gibi
biçimleri `startsWith('http')` ile süzmek yanlıştır. Ne isteneceği yerine ne
DIŞLANACAĞI (`file://`) yazılır.

**Content script izole dünyada çalışır — `window.X` sayfadan görünmez.** Tanı köprüsünün
ilk hâli `window.__dochlDiag = {...}` yazıyordu; content script'in kendi global'ine
yazdığı için sayfa (ve tarayıcı otomasyonu) hiçbir şey göremedi, köprü sessizce boş
döndü. **Ders:** izole dünya ↔ sayfa iletişimi yalnızca `postMessage` ile olur.

**Yarış + kalıcı kayıt = kilitlenme.** `syncDynamicScripts()` üç yerden çağrılıyordu;
ikisi aynı anda koşup `Duplicate script ID` üretti ve `persistAcrossSessions: true`
olduğu için diskte **yarım kalmış** bir kayıt bıraktı. Sonrasında `register` "zaten var",
`update` "yok" diyordu; `getRegisteredContentScripts` da döndürmüyordu. Çözüm: çağrıları
zincire almak + argümansız `unregisterContentScripts()` ile tüm kayıtları temizleyip
yeniden kurmak.

**`chrome.action.setIcon({path})` göreli yolu extension kökünden çözmez** — çağıran
script'in konumundan çözer. `syncFileAccess()` hem `src/background.js`'ten hem
`src/popup/popup.html`'den çağrılıyor; `"icons/icon16.png"` orada sırasıyla
`src/icons/...` ve `src/popup/icons/...` olarak aranıp `Failed to fetch` verdi.
İkon hiçbir zaman değişmiyordu ve boş bir `catch` bunu gizliyordu.
**Çözüm:** `chrome.runtime.getURL('icons/icon16.png')` — mutlak `chrome-extension://`
URL'i, çağıran nerede olursa olsun doğru çözülür.
**Ders:** runtime'da chrome API'sine verilen hiçbir kaynak yolu göreli bırakılmaz.

**Boş `catch` bu bug'ı 3 tur gizledi.** Log eklendiği anda tek seferde çıktı.
Extension kodunda sessiz `catch` yok; hata en azından `console.error`'a düşer.

## Bilinen sınırlar

- **Badge/ikon, service worker uykudayken güncellenmez.** Toggle kapatılırsa gri ikon
  ancak SW bir sonraki uyanışında görünür. Popup her zaman canlı doğru değeri gösterir.
- `tabs.query`'nin `url` filtresi `"tabs"` permission ister (kullanıcıya “tarama
  geçmişini oku” uyarısı gösterir). Kaçınmak için onboarding sekmesinin id'si
  `storage.local`'da tutuluyor.
- Content script yalnızca `file:///*` ile eşleşiyor. Web sayfalarında da çalışması
  istenirse `manifest.json`'a `http://*/*` ve `https://*/*` eklenmeli — bu ayrı bir
  permission uyarısı doğurur ve Web Store review süresini uzatır.

## Yol haritası

### Stage 1 — Chrome ✅ *(mevcut)*

Lokal `.md` / `.html` + tüm web siteleri. Highlight engine, kalıcılık, i18n,
izin akışı, icon pipeline. Sıradaki: Web Store'a yayınlama
([PUBLISHING.md](PUBLISHING.md) — eksik olan tek şey ekran görüntüsü).

### Stage 2 — Safari 🔜

Aynı kod tabanı, ayrı bir izin katmanı.

**Taşınan (~%70):** anchoring, depolama şeması, toolbar, i18n, render mantığı — hepsi
saf DOM/JS. Safari hem `browser.*` hem `chrome.*` kabul ediyor.

**Yeniden yazılacak (~%30):** `access.js` ve `sites.js`. Safari'nin izin modeli tamamen
farklı; Chrome'un "Allow access to file URLs" anahtarının karşılığı yok.

**Önce cevaplanacak soru:** *Safari lokal `.md` / `.html` dosyalarına extension erişimi
veriyor mu?* Vermiyorsa ürünün **çekirdek kullanım senaryosu** Safari'de çalışmaz ve
taşımanın anlamı kalmaz. Bu, kod yazmadan önce ölçülmeli.

**Doğrulanacak diğer maddeler** — hiçbiri denenmedi (Mac yok):

| Ne | Risk |
|---|---|
| **CSS Custom Highlight API** | Boyama katmanının **tamamı** buna bağlı. Yoksa `<mark>` sarmalamaya düşmek gerekir — bilinçli olarak reddettiğimiz yol |
| `chrome.extension.isAllowedFileSchemeAccess()` | Muhtemelen yok |
| `chrome.action.getUserSettings()` (pin durumu) | Muhtemelen yok |
| `optional_host_permissions` + `registerContentScripts` | Safari kendi izin modelini kullanıyor |
| MV3 service worker | Safari 16.4+ |

**Mimari:** tek kod tabanı + ince bir uyum katmanı (`platform/chrome.js`,
`platform/safari.js`), build ile ayrı `dist` klasörleri.

**Maliyet:** Apple Developer Program **$99/yıl** + bir **Mac** (Xcode zorunlu) +
App Store review + extension'ı bir uygulamanın içine paketleme.

Detaylı analiz: [PUBLISHING.md § Safari](PUBLISHING.md)

### Sonraki fikirler *(sıraya alınmadı)*

- **Bold** — ertelendi, bkz. yukarıdaki not
- Highlight'a **not / etiket** ekleme
- **"Tüm highlight'larım"** ekranı (bu, `chrome.storage.local` yerine IndexedDB'ye
  geçmeyi gerektirir — cross-document sorgu lazım)
- Dışa aktarma (Markdown / JSON)

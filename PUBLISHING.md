# Yayınlama — Chrome Web Store ve Safari

## Bölüm 1 · Chrome Web Store

### Hazır olanlar

| Gereken | Durum |
|---|---|
| Paket zip | ✅ `npm run pack` → `dist/notestark-<v>.zip` |
| 128×128 mağaza ikonu | ✅ `store/listing-icon-128.png` (96px artwork + şeffaf padding) |
| Manifest V3 | ✅ |
| Minify edilmemiş kaynak | ✅ (review'ı hızlandırır) |
| Tek amaç (single purpose) | ✅ dokümanlarda highlight |
| i18n | ✅ en + tr |

### Eksik olanlar

| Gereken | Nasıl |
|---|---|
| **Ekran görüntüsü** (en az 1) | **1280×800** veya 640×400 PNG/JPG. Extension'ı iş üstünde göster: highlight'lanmış bir doküman + açık araç çubuğu |
| Developer hesabı | Tek seferlik **$5** kayıt ücreti |
| Gizlilik beyanı | Aşağıya bak |
| Permission justification | Aşağıya bak — hazır metinler |

> Ekran görüntüsü çektikten sonra `node -e "require('sharp')('ss.png').resize(1280,800,{fit:'contain',background:'#fff'}).toFile('store/ss-1280.png')"` ile ölçüye getirilebilir.

### Adımlar

1. **Developer hesabı aç** → https://chrome.google.com/webstore/devconsole — $5 tek seferlik
2. **Yeni öğe** → `dist/notestark-0.8.1.zip` yükle
3. **Store listing** doldur: ad, açıklama, kategori (*Tools*), dil, 128×128 ikon, ekran görüntüsü
4. **Privacy practices** → aşağıdaki beyanlar
5. **Gönder** → review

### Gizlilik beyanı — "no data collected"

Bu extension **hiçbir veri toplamıyor ve hiçbir yere göndermiyor**. Formda:

| Soru | Cevap |
|---|---|
| Personally identifiable information | ❌ |
| Health / financial / authentication info | ❌ |
| Personal communications | ❌ |
| Location | ❌ |
| Web history | ❌ |
| **User activity** | ❌ — highlight'lar yalnızca cihazda, `chrome.storage.local` |
| **Website content** | ⚠️ **Evet işaretle** — seçilen metin cihazda saklanıyor. Sunucuya gitmiyor ama "kullanıcının seçtiği sayfa içeriği" saklandığı için dürüst cevap budur |
| Remote code kullanıyor mu | ❌ — tüm kod pakette |

Üç zorunlu onay kutusu (veri satılmıyor / amaç dışı kullanılmıyor / kredi değerlendirmesinde kullanılmıyor) işaretlenebilir.

**Privacy policy URL:** "website content" işaretlendiği için Google isteyebilir. Tek sayfalık bir metin yeter; GitHub Pages ya da bir Gist üzerinde barındırılabilir.

### Permission justification — kopyala/yapıştır

> Manuel review hattına düşmenin **bir numaralı sebebi** üstünkörü yazılmış justification'lardır. Her biri "ne için" değil "**neden başka türlü olmuyor**" sorusuna cevap vermeli.

**`storage`**
```
Highlights are stored on the user's device with chrome.storage.local so that they
reappear when the document is opened again. Nothing is sent to any server; there is
no account and no network request anywhere in the extension.
```

**`activeTab`**
```
When the user opens the popup, the extension reads only the active tab's URL to show
whether highlighting is available on that page and to offer a per-site enable button.
No content is read and no script is injected through this permission.
```

**`scripting`**
```
Used only to register a content script for the specific sites the user has explicitly
enabled through the popup, via chrome.scripting.registerContentScripts. A static
content_scripts entry is not possible because those sites are not known at install
time — the user grants them one by one at runtime.
```

**`contextMenus`** — **0.14.0'da eklendi, 0.8.0'da yoktu.** Panelde bu alan boş gelecek; doldurulmadan gönderim açılmaz.
```
Adds the extension's own actions to the right-click menu on a selection: colour,
underline, note, and switching between the rendered and source view of a Markdown
file. This is what makes the extension reachable without moving the pointer off the
passage the user just selected, which matters for a tool used while reading. The menu
is limited to file:// and http(s) pages so it never appears where the extension cannot
act, and every item is carried out by the content script — the menu itself reads
nothing from the page.
```

**`host_permissions: file:///*`**
```
The core use case is highlighting local .md and .html documentation files opened from
disk. The extension cannot read local files without this. Chrome additionally gates
this behind the user's own "Allow access to file URLs" switch, which the extension
cannot enable itself; the onboarding page only detects its state and explains how to
turn it on.
```

**`optional_host_permissions: *://*/*`**
```
Declared as OPTIONAL on purpose: nothing is requested at install time. The user grants
one origin at a time from the popup ("Enable on this site") when they want to highlight
that page. Permission can be revoked the same way. The extension never requests all
sites at once.
```

**Single purpose** — 0.8.0'daki hâli notu ve çeviriyi kapsamıyordu; ikisi de eklendiği için yeniden yazıldı. Tek amaç ifadesi hâlâ **tek** bir cümle: ürün "okuduğun pasajı işaretlemek", not ve çeviri de o pasaja bağlı işaretler.
```
Let the user mark up passages in documents they read in the browser — a colour, an
underline, a note, or a translation kept as a note — and have those marks reappear
when the document is opened again. Everything the extension adds is attached to a
passage the user selected; there is no second, unrelated function.
```

### Review süresi — beklenti

Resmî beyan: çoğu extension **birkaç gün**, bazıları **birkaç hafta**; 3 haftayı geçerse
developer support'a yazılır ([Chrome for Developers](https://developer.chrome.com/docs/webstore/review-process)).
2026'da başvuru hacmi arttığı için süreler uzamış durumda
([ExtensionBooster](https://extensionbooster.com/blog/chrome-web-store-extension-review-time-2026-how-long-guide/)).

**Bizi yavaşlatabilecek tek şey:** yeni developer hesabı + `file:///*`. Buna karşılık
`<all_urls>` **yok**, `tabs` / `cookies` / `webRequest` **yok**, remote code **yok**,
minify **yok** — bunların hepsi hızlı hatta kalmayı destekliyor.

### Sonraki güncellemeler

Her sürüm yeniden review'dan geçer, ama yerleşmiş bir öğede küçük güncellemeler
genelde hızlıdır. `manifest.json` ve `package.json` içindeki `version` birlikte
artırılır, `npm run pack`, yeni zip yüklenir.

### Mağazaya hiç girmeden

Kişisel kullanım için **"Load unpacked" süresiz çalışır**. Tek dezavantajı Chrome'un
Windows'ta her açılışta gösterdiği *"Geliştirici modundaki uzantıları devre dışı bırak"*
uyarısıdır. Rahatsız etmiyorsa $5 ve review beklemeye gerek yok.

---

## Bölüm 2 · Safari

### Kısa cevap

**Aynı kod büyük ölçüde kullanılabilir, ama olduğu gibi değil.** Safari 14'ten beri
WebExtension standardını destekliyor ve MV3'ü de destekliyor — **ancak farklı bir API
alt kümesiyle** ([chromium-extensions tartışması](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/q9Ed3hhj_JE)).
Bizim kodda en çok emek verdiğimiz katman (izin akışı) tam da farklılaşan yerde.

### Dönüştürme

Apple'ın resmî aracı, **macOS + Xcode gerektirir**:

```bash
xcrun safari-web-extension-converter --bundle-identifier com.ornek.dochighlighter ./extension
```

Bu, extension'ı saran bir **Xcode projesi** üretir. Safari'de extension tek başına
dağıtılamaz — bir **macOS/iOS uygulamasının içinde** paketlenir
([Evil Martians rehberi](https://evilmartians.com/chronicles/how-to-quickly-and-weightlessly-convert-chrome-extensions-to-safari)).

Safari imzasız extension göstermez; geliştirme sırasında *Develop → Allow Unsigned
Extensions* açılır ([dönüştürme notları](https://gist.github.com/rxliuli/940584d75f55de3a4e9e2c5682bbcae8)).

### Ne çalışır, ne çalışmaz — bizim koda göre

| Parça | Safari'de |
|---|---|
| `chrome.*` namespace | ✅ Safari hem `browser.*` hem `chrome.*` kabul ediyor |
| `chrome.storage.local` | ✅ |
| Content script + shadow DOM toolbar | ✅ |
| Anchoring / metin indeksi | ✅ Saf DOM ve JS, tarayıcıdan bağımsız |
| MV3 service worker | ⚠️ Safari 16.4+ destekliyor; öncesi farklı |
| `chrome.i18n` + `_locales` | ✅ |
| **CSS Custom Highlight API** | ⚠️ **Doğrulanmalı.** Motorun boyama katmanının tamamı buna bağlı. Desteklenmiyorsa `<mark>` sarmalamaya düşmek gerekir — reddettiğimiz yol |
| **`chrome.extension.isAllowedFileSchemeAccess()`** | ❌ Muhtemelen yok. Safari'nin izin modeli tamamen farklı |
| **`file://` erişimi** | ❌ Safari'de Chrome'daki gibi bir "Allow access to file URLs" anahtarı yok; izin modeli site bazlı ve daha kısıtlı |
| `chrome.action.getUserSettings()` (pin durumu) | ❌ Muhtemelen yok; Safari'de pin kavramı farklı |
| `optional_host_permissions` + `registerContentScripts` | ⚠️ Safari izinleri "Always Allow / Allow for One Day" gibi kendi modeliyle yönetiyor |

> ⚠️ Bu tablodaki ❌/⚠️ satırları **doğrulanmadı** — Mac'im yok, deneyemedim.
> Genel API uyumu bilinen bir şey ama bizim özel çağrılarımızın Safari karşılığını
> ölçmek gerekir. Kesin bilgi ancak dönüştürüp çalıştırınca çıkar.

### Pratik sonuç

**Yeniden kullanılabilir (~%70):** anchoring, depolama şeması, toolbar, i18n, render
mantığı — motorun kendisi.

**Safari'ye özel yazılacak (~%30):** izin/onboarding katmanı. `access.js` ve `sites.js`
neredeyse tamamen Chrome'a özgü; Safari için ayrı bir uygulama gerekir.

**Doğru mimari:** tek kod tabanı + tarayıcıya göre değişen ince bir uyum katmanı
(`platform/chrome.js`, `platform/safari.js`), build ile ayrı `dist` klasörleri
üretmek. Bu, cross-browser extension'larda yerleşik kalıptır
([cross-browser rehberi](https://extensionbooster.net/blog/cross-browser-extension-development-chrome-firefox-safari-edge-guide/)).

### Maliyet

| Kalem | Chrome | Safari |
|---|---|---|
| Geliştirici ücreti | **$5** tek seferlik | **$99/yıl** Apple Developer Program |
| Donanım | Yok | **Mac** (Xcode zorunlu) |
| Paketleme | zip | Xcode projesi + uygulama sarmalayıcı |
| Dağıtım | Web Store | **App Store** (ayrı review) |

### Öneri

**Önce Chrome'da yayınla, kullanım gör, sonra Safari'ye bak.** Safari'ye taşımanın
bedeli yılda $99 + bir Mac + ayrı bir izin katmanı; bunu talep görmeden ödemek erken.
Ayrıca `file://` desteği Safari'de belirsiz — ürünün **çekirdek kullanım senaryosu**
orada çalışmayabilir. Bu, taşımadan önce cevaplanması gereken ilk soru.

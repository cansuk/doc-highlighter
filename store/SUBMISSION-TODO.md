# Chrome Web Store — 0.16.0 güncellemesi

> **DURUM — 21.08.2026.** Mağazada yayında olan sürüm **0.8.0**. Yüklenecek olan
> **0.16.0**: 0.8.0'dan bu yana sekiz sürümlük iş var (markdown preview, panel,
> sticky note, sağ tık menüsü, cihaz üstü çeviri, Recent sekmesi, isim değişikliği).

**Paket:** `dist/notestark-0.16.0.zip` — 81.0 KB
**Ad:** Notestark Notes — Highlight Local Markdown & the Web
**Kategori:** Tools

---

## Yüklenecek dosyalar — hepsi hazır

| Alan | Dosya | Ölçüldü |
|---|---|---|
| Paket | `dist/notestark-0.16.0.zip` | 81.0 KB |
| Ekran görüntüsü 1 | `store/screenshots/1-web.png` | 1280×800, PNG, 3 kanal, alfa yok |
| Ekran görüntüsü 2 | `store/screenshots/2-markdown.png` | 1280×800, PNG, 3 kanal, alfa yok |
| Ekran görüntüsü 3 | `store/screenshots/3-note.png` | 1280×800, PNG, 3 kanal, alfa yok |
| Ekran görüntüsü 4 | `store/screenshots/4-translate.png` | 1280×800, PNG, 3 kanal, alfa yok |
| Store ikonu 128×128 | `store/listing-icon-128.png` | 128×128, alfa **var** — bu alanda doğrusu bu |
| Küçük tanıtım 440×280 | `store/promo-small-440x280.png` | 24-bit, alfa yok |
| Kayan yazı 1400×560 | `store/promo-marquee-1400x560.png` | 24-bit, alfa yok |
| Metinler (EN) | `store/listing-en.txt` | ad 52/75 · kısa 102/132 · uzun 6026/16000 |
| Metinler (TR) | `store/listing-tr.txt` | ad 52/75 · kısa 96/132 · uzun 5915/16000 |

Alfa kuralı yalnızca **ekran görüntüleri ve tanıtım görselleri** için geçerli; store
ikonundaki şeffaf 16px kenar Google'ın kendi istediği şey.

Ekran görüntüleri `node tools/shot.mjs "<pencere başlığı>" <ad>` ile üretiliyor. Arayüz
değişince elle yeniden çekmek gerekmiyor — eskisi tam olarak böyle bayatlamıştı.

---

## 0.8.0'dan bu yana DEĞİŞEN ve panelde iş çıkaracak şeyler

### 1. Yeni izin: `contextMenus` — alan boş gelecek

0.14.0'da sağ tık menüsüyle birlikte eklendi. Chrome, yeni bir izin gördüğünde
**Gizlilik uygulamaları** sekmesinde o izne ait boş bir gerekçe alanı açar ve
doldurulmadan gönderim düğmesi açılmaz.

Hazır metin: `PUBLISHING.md` → *Permission justification* → **`contextMenus`**.

Diğer izinlerin (`storage`, `activeTab`, `scripting`, `file:///*`, `*://*/*`)
gerekçeleri 0.8.0'da girildi ve **korunur**; yeniden yazılmaları gerekmez.

### 2. Tek amaç (single purpose) ifadesi yeniden yazıldı

0.8.0'daki hâli yalnızca "highlight ve underline" diyordu; artık not ve çeviri de var.
Yeni metin `PUBLISHING.md` içinde. Eskisi teknik olarak yanlış olmasa da eksik, ve
eksik bir tek amaç ifadesi manuel incelemeye düşmenin bilinen sebeplerinden.

### 3. Ürün adı değişti

Listelemedeki ad `Notestark Notes — Highlight Local Markdown & the Web` olacak.
Depo adı `doc-highlighter` olarak **kalıyor** (bilinçli — yalnızca bu eklenti açık
kaynak). Açıklama metnindeki GitHub linki eski adı gösteriyor, doğrusu bu.

### 4. Açıklama metinlerindeki sınırlar bölümü güncellendi

0.8.0'da "not, etiket, arama yok" yazıyordu. Not artık **var**; metinlerde kalan sınır
"etiket ve arama henüz yok". Eski metni kopyalayıp yapıştırma.

---

## Sırasıyla ne yapılacak

1. **Paket** — Paket → Yeni paket yükle → `dist/notestark-0.16.0.zip`
2. **Ekran görüntüleri** — Mağaza girişi → önceki iki görseli **kaldır**, dört PNG'yi yükle
3. **Ad ve açıklamalar** — `store/listing-en.txt` içindeki üç bloğu yapıştır
4. **Gizlilik uygulamaları** — `contextMenus` gerekçesi + yeni tek amaç ifadesi
5. **Türkçe** — dil ekle, `store/listing-tr.txt` yapıştır *(isteğe bağlı)*
6. **İncelemeye gönder**

İnceleme sürerken paket **kilitlenir**; "Yeni paket yükle" pasif olur. Listeleme
alanları düzenlenebilir kalır.

---

## Yapılmayanlar ve sebepleri

**Tanıtım videosu.** Mağaza yalnızca **YouTube URL'si** kabul ediyor, dosya yüklenmiyor.
`docs/img/notestark-flow.gif` akışı gösteriyor ve README ile site için yeterli, ama
mağazaya konamaz — video isteniyorsa ekran kaydı alınıp YouTube'a yüklenmeli.

**İzin verme akışının videosu.** İstendi, yapılamadı: izin balonu ve
`chrome://extensions` Chrome'un kendi arayüzünde ve oraya ne eklenti ne tarayıcı
otomasyonu erişebiliyor. Bu adımların kaydı ancak ekran kaydı ile alınabilir.

---

## ⚠️ ENGEL — gizlilik metni URL'i açılmıyor

`multiappsoftwareservices.com` üzerindeki **TLS sertifikasının süresi dolmuş**.
21.08.2026'da yeniden ölçüldü, 17.08'deki durum aynen sürüyor:

```
http://www.multiappsoftwareservices.com/notestark/privacy  → 301 (https'e yönlendiriyor)
https://www.multiappsoftwareservices.com/                  → SEC_E_CERT_EXPIRED
```

Yani tarayıcı sayfayı **hiç açmıyor**, uyarı ekranı gösteriyor.

Bunun neden önemli olduğu: veri beyanında **"Website content"** işaretli, o yüzden
gizlilik metni URL'i zorunlu ve inceleyen kişi o linke **tıklıyor**. Açılmayan bir
link, eklentinin kendisiyle hiç ilgisi olmayan bir sebeple inceleme kaybettirir.

**Yüklemeden önce yapılacak:** ya sertifika yenilenmeli, ya da gizlilik metni URL'i
sertifikası çalışan bir yere taşınmalı (GitHub Pages ya da bir Gist bir dakikada
çözer — metin `PRIVACY.md` içinde, `site/privacy.html`'den üretiliyor).

Ayrıca `site/index.html` içinde **`STORE_URL` yer tutucusu hâlâ doldurulmamış**
(satır 117, "Add to Chrome" düğmesi) — sayfa yayına alınacaksa o da doldurulmalı.

**Resmî URL (official URL) alanı** ayrıca Google Search Console doğrulaması istiyor;
o alan zorunlu değil, sertifika sorunu çözülene kadar boş bırakılabilir.

---

## Kayda geçen kararlar

- **Minify edilmiyor.** Minify/obfuscate edilmiş gönderimler daha uzun inceleniyor ve
  paket 81 KB — kazanılacak bir şey yok.
- **Depo public**, GPL-3.0 (18.08.2026). Her iki açıklamada da OPEN SOURCE bölümü var.
- **Sınırlar açıklamada bilerek yazılıyor** (Chrome 105+, çeviri için 138+, etiket ve
  arama yok, bazı SPA'larda zayıf kalıcılık). Gizlemek tek yıldızlı yorum üretiyor.

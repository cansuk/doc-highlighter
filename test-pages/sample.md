# Markdown test sayfası

Bu dosya Doc Highlighter'ı denemek için var. İçindeki metinler bilinçli olarak
farklı yapılarda: paragraf, liste, tablo, kod, alıntı.

## Tek element içinde seçim

Bu paragrafın tamamı tek bir metin bloğu. Highlight'ın en kolay senaryosu budur:
seçim başlangıcı ve bitişi aynı blok içindedir. Bu cümleyi baştan sona seçmeyi dene.

## Elementler arası seçim

Zor senaryo şu: seçim **bir blokta başlayıp** başka bir blokta bitiyorsa, DOM wrapping
yaklaşımı *iç içe geçmiş* yapılar üretir. Bu paragrafın ortasından başlayıp aşağıdaki
listenin ikinci maddesine kadar sürükleyerek seç.

- Birinci madde — kısa.
- İkinci madde — seçimin burada bitmesini dene.
- Üçüncü madde — bu dışarıda kalsın.

## Tekrar eden metin

Anchoring'in en sinsi sorunu: aynı metin sayfada birden çok kez geçtiğinde hangisinin
highlight'landığını ayırt etmek. Aşağıdaki üç satırda `durum` kelimesi üç kez geçiyor.

| Alan  | Açıklama                        |
|-------|---------------------------------|
| durum | Başvurunun mevcut durum bilgisi |
| durum | Ödemenin durum kodu             |
| durum | Sertifikanın durum geçmişi      |

> Bir highlight, sayfa yeniden yüklendiğinde aynı yere oturmuyorsa highlight değildir;
> sadece bir kez görülmüş bir renktir.

## Uzun metin

Kaydırma gerektiren bir bölge olsun diye buradan aşağısı doldurma metnidir. Sayfa
yeniden yüklendiğinde highlight'ın görünür alanın dışında kalması ve kullanıcının onu
bulamaması ayrı bir UX sorunudur.

İçerik hash'i test etmek için: bu dosyayı kopyalayıp adını değiştir. Hash aynı kaldığı
sürece highlight'lar yeni dosyada da görünmeli. Sonra bu paragrafa bir kelime ekle —
hash değişir, fallback anchoring devreye girmeli.

```js
// kod blogu — secim burada da calismali
const key = await sha256(document.body.innerText);
```

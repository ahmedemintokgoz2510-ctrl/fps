# Arkadaş FPS — online 3D takım ölüm maçı (APK)

5v5'e kadar (en fazla 10 kişi), oda kodu ile arkadaşlarla oynanan 3D FPS. Dokunmatik kontroller:
sol yarıda sürükle = yürü, sağ yarıda sürükle = bak, ATEŞ butonunun üstünde sürükleyerek de nişan alabilirsin.
3 silah: tüfek, tabanca, keskin nişancı (dürbün). İlk 30 öldürmeye ulaşan takım kazanır.

## 1) Sunucuyu kur (bir kişi yapar, ücretsiz)
1. GitHub'da hesap aç, yeni bir **repo** oluştur, bu klasördeki **tüm dosyaları** (gizli `.github` klasörü dahil) yükle.
2. https://render.com → GitHub ile giriş → **New → Blueprint** → repoyu seç → Deploy. (`render.yaml` her şeyi ayarlar.)
3. Bitince adresin şuna benzer: `https://arkadas-fps.onrender.com`. Oyundaki sunucu adresi: `wss://arkadas-fps.onrender.com`
4. Ücretsiz Render 15 dk boşta kalınca uyur; ilk bağlanış 30-50 sn sürebilir. Normal.

## 2) APK'yı derlet (otomatik)
Repo'ya dosyaları yüklediğin anda GitHub Actions çalışır (Actions sekmesinde izle, ~8-12 dk).
Bitince repo'nun **Releases** bölümünde `app-debug.apk` çıkar → telefondan indir → kur
("bilinmeyen kaynaklardan yüklemeye izin ver" demen gerekir). Arkadaşlarına aynı linki at.

Sunucu adresini sabitlemek istersen `www/config.js` içine yaz, yoksa menüdeki kutuya her biri bir kez yazar (hatırlanır).

## 3) Oyna
Biri **ODA KUR**'a basar, ekranın solundaki 4 harfli kodu arkadaşlarına söyler, onlar kodu yazıp **ODAYA KATIL** der.
Takımlar otomatik dengelenir.

## Yedek yol (APK olmadan)
Render adresini telefon tarayıcısında aç → menü → "Ana ekrana ekle". Aynı oyun.

## Bilgisayarda deneme
`npm install && node scripts/prepare-www.js && npm start` → http://localhost:3000 (WASD, fare, Boşluk, R, 1-2-3, sağ tık = dürbün)

## Dosyalar
- `server.js` — oda sistemi, isabet/hasar hesabı (sunucu belirler, hile zor)
- `www/shared.js` — harita + fizik (sunucu ve oyun aynı dosyayı kullanır)
- `www/game.js`, `www/index.html` — oyun istemcisi (Three.js)
- `.github/workflows/apk.yml` — APK derleme tarifi

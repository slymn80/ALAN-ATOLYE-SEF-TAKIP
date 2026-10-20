# Alan & Atölye Şef Takip

2026-2027 eğitim öğretim yılı için alan ve atölye şeflerinin haftalık görev günü/saat takibini yapan web uygulaması.
Takvim, MEB'in resmî ders yılı tarihleri olan 14 Eylül 2026–25 Haziran 2027 aralığını kullanır.

## Çalıştırma

Node.js 22.5 veya daha yeni bir sürüm gerekir. İlk kurulumda bağımlılıkları yükleyin, ardından uygulamayı başlatın:

```powershell
npm.cmd install
npm.cmd start
```

Ardından `http://127.0.0.1:3000` adresini açın.

İlk çalıştırmadan önce yönetici bilgilerini ortam değişkenleriyle verin:

```powershell
$env:ADMIN_USERNAME='yonetici'
$env:ADMIN_PASSWORD='guclu-bir-ilk-sifre'
$env:CHIEF_DEFAULT_PASSWORD='sefler-icin-ortak-ilk-sifre'
$env:HOST='0.0.0.0'
npm.cmd start
```

`ADMIN_PASSWORD` verilmezse güvenli ve rastgele bir ilk şifre üretilerek yalnızca sunucu terminalinde gösterilir. İlk girişte şifre değişikliği zorunludur. Render ortamında `ADMIN_PASSWORD` mutlaka gizli ortam değişkeni olarak tanımlanmalıdır.

## Özellikler

- PDF listesindeki 5 alan ve 17 şef başlangıç verisi olarak hazırdır.
- Tüm şef hesapları sabit kullanıcı adlarıyla otomatik oluşturulur. Başlangıç şifresi `CHIEF_DEFAULT_PASSWORD` ortam değişkeninden alınır ve ilk girişte değiştirilmesi zorunludur.
- Hatalı giriş sayısı nedeniyle hesap veya IP kilitlemesi uygulanmaz.
- Yönetici, her şef için kullanıcı adı ve geçici şifre oluşturabilir; hesabı pasife alabilir veya şifreyi sıfırlayabilir.
- `şeflik saatleri.xlsx` çizelgesindeki haftalık şeflik planı her kişi için hazırdır.
- `çalışma saatleri.png` dosyasındaki 1-11. ders başlangıç/bitiş saatleri sisteme işlenmiştir (1. ders 08.20–09.00, 11. ders 17.20–18.00).
- Günlük ders saati sınırları pazartesi 11, salı 10, çarşamba 9, perşembe 11 ve cuma 10 olarak hem arayüzde hem sunucu doğrulamasında uygulanır.
- Şefler, eğitim yılı içindeki haftalarda pazartesi-cuma ve 1-11. ders saati tablosundan geldikleri saatleri işaretleyebilir.
- Yönetici, haftalık kişi/gün/ders saati özetini ve planlanan saate göre durumu görüntüleyebilir.
- Yönetici haftalık, aylık veya yıllık raporu; tüm şefler ya da seçtiği tek kişi için Türkçe karakter destekli PDF olarak indirebilir.
- Şef API'leri oturumdaki kullanıcı kimliğine sabitlenmiştir; her şef yalnızca kendi kayıtlarını görür. Tüm kayıtlara yalnızca admin rolü erişebilir.
- Şifreler `scrypt` ile özetlenir; oturumlar güvenli, `HttpOnly` çerezle tutulur.
- Tüm bilgiler `data/takip.db` SQLite veritabanında kalıcı olarak saklanır.

## Yedekleme

Sunucu kapalıyken `data/takip.db` dosyasını kopyalamak yeterlidir. Çalışan sistemde tutarlı yedek için SQLite `.backup` mekanizması tercih edilmelidir.

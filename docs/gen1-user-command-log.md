# KATANA Gen 1 — kullanıcı komutlarıyla MCP deneme günlüğü

Bu günlük yalnız kullanıcının buradan verdiği komutları ve bunların sonuçlarını
kaydeder. Önceden asistanın kendiliğinden çalıştırdığı testler, kullanıcıyla
birlikte yapılmış komut denemeleri olarak değerlendirilmez.

## Oturum kuralları

- Kullanıcı komutu olmadan ek test veya cihaz işlemi başlatılmaz.
- Cihaza yazma, patch save ve firmware işlemleri ayrıca açık onay gerektirir.
- Yazma onayı, adaptörün desteklemediği bir işlemi desteklenir hale getirmez.
- Her kayıtta istek, gerçekten yapılan çağrılar, sonuç ve kapsam ayrılır.
- Kayıtlı sonuçlar başka model veya firmware için çalışma garantisi değildir.

## 1. Metal tonu isteği

- Zaman: 2026-10-23 21:32 (Europe/Istanbul).
- Kullanıcı komutu: **“bana metal tonu ver”**.
- Hedef: BOSS KATANA-50 Gen 1; mevcut yerel Gen 1 MIDI adaptörü.
- Sonuç: **UYGULANMADI — mevcut adaptör tam ton yazmasını desteklemiyor.**
- Fiziksel MCP/MIDI çağrısı: **Yok**. Bağlantı, okuma veya ek test başlatılmadı.
- Cihaza yazma / patch save / firmware işlemi: **Yok**.
- Yapılan yerel işlem: `src/gen1/parameters.ts` içindeki yazma izinleri incelendi.

Metal tonu uygulamak amfi türü, Gain, EQ ve/veya efekt ayarlarında yazma
gerektirir. Mevcut Gen 1 adaptöründe bu genel yazma yolu yoktur. Yalnız
`TemporaryGain` için ham 95/96 değerlerine sınırlı deneysel yazma altyapısı vardır;
bu, metal tonu kurma desteği değildir. Volume/EQ/efekt yazmaları salt okunur
politika nedeniyle engellenir. Kullanıcıdan bu komut için ayrıca yazma onayı
alınmadı; desteklenmeyen bir işlem için onay istenmedi.

Bu sonuç cihazdan alınmış bir MCP hata yanıtı değildir; çağrı yapılmadan önce
kaynak kodundaki yetenek sınırından saptanmıştır. Metal tonu cihazda kurulmuş
veya denenmiş olarak raporlanamaz.

## 2. Metal tonu desteği ve açık yazma onayı

- Kullanıcı komutu: **“destegi getir. yazma onayını veriyorum”**.
- Fiziksel koşul yanıtı: **“Evet, fiziksel MASTER düşük”**.
- Yetkilendirilen iş: Gen 1 geçici ton yazma desteğini geliştirmek ve istenen metal
  başlangıç tonunu uygulamak. Patch save / firmware yetkisi verilmedi.
- Kaynak araştırması: Kurulu Tone Studio 4.0.0 adres haritası ve SWF içindeki
  `preamp_a_gain`, EQ, LEVEL, NS1 Threshold tanımları salt okunur incelendi.
  Gain 0..120, EQ/Presence/LEVEL ve NS1 Threshold 0..100 statik aralıkları
  sabit dosya hash'leri ve FWS ofsetleriyle bağımsız doğrulandı.
- Yeni araç: `katana_gen1_apply_tone`; varsayılan `dryRun=true`, sıfır MIDI I/O.
- Tone Studio açık bulundu; otomatik kapatılmadı. Kullanıcı daha sonra
  **“Tone Studio’yu kapattım”** yanıtını verdi; süreç listesi kapanmayı doğruladı.
- Fiziksel uygulama: **PASS — 2026-10-23 21:48:39–21:48:41 Europe/Istanbul**.
- Cihaza yazma: **9 geçici DT1**, 8 ayrı adres; LEVEL iki kez yazıldı.
- Patch save / firmware: **Yok**.

Planlanan ham DSP değerleri: TemporaryAmpType 23 (SLDN/Brown; panel kodu 4 ile
karıştırılmaz), Gain 85, Bass 60, Middle 40, Treble 65, Presence 45;
Booster/Mod/FX/Delay/Reverb OFF; NS1 ON, Threshold 55. TemporaryLevel önce 0,
sonunda `min(önceki LEVEL, 5)`; yazılabilir genel yazılım tavanı 10.
Bu seviyeler akustik ses şiddeti garantisi değildir; fiziksel MASTER düşük kalır.

Gerçek SDK/MCP stdio çağrıları, sırasıyla:

1. `katana_gen1_status` — yazma kapıları bu tek süreçte açık, henüz bağlı değil.
2. `katana_gen1_apply_tone {name:"metal"}` — varsayılan dryRun, sıfır MIDI I/O.
3. `katana_gen1_discover` — tek KATANA input/output çifti bulundu.
4. `katana_gen1_connect` — Roland kimliği eşleşti; firmware bilinmiyor.
5. `katana_gen1_apply_tone {name:"metal",outputLevel:5,dryRun:false}` — PASS.
6. `katana_gen1_disconnect` — temiz kapanış; kilit/cleanup hatası yok.

| Ham etkin alan | Önce | Sonra |
| --- | ---: | ---: |
| TemporaryAmpType | 1 | 23 |
| TemporaryGain | 54 | 85 |
| TemporaryBass | 54 | 60 |
| TemporaryMiddle | 58 | 40 |
| TemporaryTreble | 46 | 65 |
| TemporaryPresence | 16 | 45 |
| BoosterOn / ModOn / FxOn / DelayOn / ReverbOn | Hepsi 0 | Hepsi 0; DT1 atlandı |
| NoiseSuppressorOn | 1 | 1; DT1 atlandı |
| NoiseSuppressorThreshold | 47 | 55 |
| TemporaryLevel | 28 | Önce 0, sonunda 5 |

Bir kimlik sorgusu, 70 RQ1, 9 DT1 gönderildi; 71 RX alındı. Guard tarafından
engellenen gönderim yok. Her hedef geri okumayla doğrulandı. Ses kaydı/dinleme,
güç döngüsü, farklı firmware, sök-tak veya ek donanım testi yapılmadı. Ton geçici
durumda bırakıldı; kalıcı patch kaydı yapılmadı. Yazma onayı, gelecekte kullanıcının
komut vermediği ek testleri kendiliğinden başlatmak için kullanılmayacak.

Kanıtlar: `boss-katana-mcp/docs/evidence/gen1-metal-2026-10-23/`.
Bağımsız salt okunur doğrulama: `python scripts/Verify-Gen1MetalEvidence.py` PASS.
Audit SHA-256: `839070b752665da3a12c4e6be77bc02423b1ef46634130ec7a79db1bfa301bf8`.
Ayrıntılı rapor: `boss-katana-mcp/docs/gen1-hardware-metal-2026-10-23.md`.


## 3. Kullanıcı komutu: “metal tonu yap”

2026-10-23 22:01 (Europe/Istanbul). Önceki açık yazma onayı ve düşük MASTER
teyidi geçerlidir. Doğrulanmış kaynak/build hash'leri eşleşti; ek bağımsız test
başlatılmadı. Gerçek MCP üzerinden metal planı önizlendi, keşif/kimlik doğrulandı,
plan bir kez uygulandı ve bağlantı kapatıldı. **PASS**: 1 inquiry, 70 RQ1,
**7 DT1**, 71 RX; engellenen TX ve cleanup hatası yok. Ham hedefler: Brown 23,
Gain 85, Bass 60, Middle 40, Treble 65, Presence 45, NS1 ON/55; efektler OFF.
LEVEL 28→0→5; Presence 45 ve NS1 Threshold 55 zaten eşleştiğinden DT1 atlandı.
Bu ön değerlerin önceki oturumdan neden farklı olduğu araştırılmadı.
Kanıt: `katana-evidence/gen1-metal-command-20261023-2201/`.
Audit SHA-256: `7713389b9809f7fc16470aa7ebb8af6c6dbf9b048e1c86240aee3585a8520bda`.

## 4. Kullanıcı komutu: “delay ekle ve reverb”

2026-10-23 22:02–22:04 (Europe/Istanbul). Önce iki açma anahtarı yazıldı:
DelayOn 0→1 ve ReverbOn 0→1, ikisi de geri okumayla doğrulandı. **PASS**:
1 inquiry, 11 RQ1, 2 DT1, 12 RX. Fakat ReverbLevel **0** okundu; yalnız
anahtarı açmak, duyulur reverb eklenmesini sağlamaz. Bu sınırlama kullanıcıya
bildirildi; bu ilk aşama tek başına duyulur reverb başarısı olarak sayılmaz.

Kurulu BTS'nin SWF tanımlarından `reverb_effect_level` (FWS id 0x919a16,
min/max 0x919a2b: 0..100) ve `delay_effect_level` (id 0x9185a2,
min/max 0x9185b7: 0..120) doğrulandı. Adresler temporary haritasında
Reverb `60 00 06 18`, Delay `60 00 05 66` olarak doğrulandı. Yeni yazma yolu
her iki efekt seviyesi için **0..30 yazılım tavanıyla** sınırlandı; kaynak
aralığı, akustik güvenlik garantisi sayılmadı. Unit/mock testleri ve build geçti:
**139 PASS / 49 SKIPPED**; gerçek Gen 3 testi yapılmadı.

İkinci MCP oturumunda mevcut anahtarlar tekrar doğrulandı ve efekt seviyeleri
ham **15** yapıldı. Delay/Reverb ON son okumaları 1, DelayLevel/ReverbLevel
son okumaları 15; TemporaryLevel başlangıçta ve sonda 5. Bu aşamada yalnız iki
seviye DT1'i gönderildi; 1 inquiry, 18 RQ1, 2 DT1, 19 RX, temiz disconnect.
DelayTime 456 ve DelayFeedback 35 okundu; bu iki parametreye yazılmadı.
Efekt algoritmaları değiştirilmedi. Ses kaydı/dinleme yapılmadı.

Kanıtlar: `katana-evidence/gen1-delay-reverb-command-20261023-2202/` ve
`katana-evidence/gen1-delay-reverb-levels-command-20261023-2204/`.
Son audit SHA-256: `e0676644ca41e9af7e93a7b81138152b9f0a291490932274d28bb3ff54b175ea`.
İkinci oturumun raporundaki sourceRevision geliştirme öncesi HEAD'dir; yeni
parametre dosyasının kaynak/derlenmiş baytları, hash'leri ve farkı ayrıca
`source-snapshot.json` ile korunur. Rapor geriye dönük değiştirilmedi.
Patch save / firmware / otomatik retry / rollback: **Yok**.


## 5. Kullanıcı komutu: “arttır duyamıyorum”

2026-10-23 22:08 (Europe/Istanbul). Bağlam gereği delay/reverb efekt seviyeleri
artırıldı; ana sesin artırılması olarak yorumlanmadı. Gerçek MCP üzerinden
kimlik ve bağlantı doğrulandı, mevcut değerler okundu.

- Delay efekt seviyesi: ham **15 → 25**, geri okuma PASS.
- Reverb efekt seviyesi: ham **15 → 25**, geri okuma PASS.
- DelayOn/ReverbOn: son okumalar **1/1**.
- Ana TemporaryLevel: **5 → 5**, bu adrese DT1 gönderilmedi.
- Audit: 1 inquiry, 18 RQ1, 2 DT1, 19 RX; blocked TX 0.
- Bağlantı temiz kapandı; patch save, firmware veya otomatik retry yok.
- Duyulurluk henüz kullanıcı tarafından teyit edilmedi.
- Ham kanıt: `katana-evidence/gen1-effects-increase-command-20261023-2208/`.
- Audit SHA-256: `d37c8d986e7c9d4eb550b9cc6bec4b61df101ca606a52d3d3abc8bf1436e8bf1`.


## 6. Kullanıcı komutu: “neden gelmiyor 50 falan yap”

2026-10-23 22:10 (Europe/Istanbul). Kullanıcı isteğiyle yalnız DelayLevel ve
ReverbLevel yazılım tavanı 30→50 genişletildi; kaynak aralıkları (120/100), ana
LEVEL tavanı 10, donanım/yazma başlangıç kapıları değişmedi. Build PASS ve
Gen 1 offline testleri **118/118 PASS**. Kaynak veya protokol sınırı uydurulmadı.

Gerçek MCP'de DelayLevel **25→50**, ReverbLevel **25→50** yazıldı ve geri
okundu. DelayOn/ReverbOn son değerleri 1/1; TemporaryLevel 5→5 kaldı. Panel
DelayFx=9, Reverb=14, Volume=5 ve SignalChainPattern=0 salt okunur sorgulandı.
Bu panel alanlarına yazılmadı; sıfır olmayan panel kodları tek başına ses
etkisini kanıtlamaz. 1 inquiry, 22 RQ1, **2 DT1**, 23 RX; blocked TX 0;
kimlik eşleşti ve bağlantı temiz kapandı. Patch save/firmware/retry yok.

Kullanıcı dinleme çıkışını **“Amfinin hoparlörü”** olarak belirtti. 50 sonrası
sonuç sorusuna **“Artık duyuluyor”** yanıtı verdi. Sonuç: **PASS — cihaz geri
okuması + kullanıcı tarafından duyulur etki teyidi**. Bu bir ses ölçümü veya
başka firmware/çıkışlar için garanti değildir; 25'te duyulmamasının tek ve kesin
teknik nedeni saptanmış sayılmaz. Ayarlar bu noktada bırakıldı; ek test yok.

Kanıt: `katana-evidence/gen1-effects-50-command-20261023-2210/`.
Audit SHA-256: `78661db49a7d6d3b5ff9b3184917552071dbf98cc32f8cbc835d66d526ae83aa`.
Kaydedilen runner'ın `request` etiketi kopyalama sırasında karakter kodlaması
nedeniyle önceki komutu bozuk karakterlerle taşıdı; yapılan MCP çağrıları ve ham
50 değerleri doğrudur. Orijinal rapor değiştirilmedi; doğru kullanıcı komutu,
çalışma ağacı kaynak/derlenmiş parametre dosyaları, hash'leri ve kullanıcı
ses teyidi `supplement.json` ile ayrıca korundu.

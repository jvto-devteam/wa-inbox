# Perbandingan knowledge: jvto-ekosistem vs wa-inbox — 2026-09-18

## Metodologi

Seluruh isi `/Users/macbook/Code/jvto-ekosistem` dibaca penuh oleh 12 subagent paralel,
mencakup:

- **Core 1** (`1-knowledge-and-evidence-core`) — seluruh 144 file: credentials, organization-identity,
  people-and-crew, isic, narrative-claims, why-jvto (+ 11 halaman kru individual), markets, contact,
  home, blog, fact-review-and-ownership, destination-knowledge, destinations, travel-guide (12 file),
  stable-operational-guidance, health-and-safety-rules, policies, tours (+ faq-spine), faqs (21 file).
- **Core 2** (`2-product-and-commercial-core`) — seluruh 94 file: 17 `*.product-contract.json` +
  17 `*.itinerary.json` (dibaca day-by-day penuh), pricing-rules (19 file termasuk cost-components
  internal), add-ons, cancellation-and-credit-rules, deposit-rules, health-requirements,
  inclusions-and-exclusions, luggage-and-pax-rules, channel-availability (16 file per-produk).
- **Core 3 &amp; 4** (booking-and-journey-core, operations-core) — seluruh file dibaca; dipisahkan
  antara kebijakan umum yang bisa dipakai bot (closure-and-plan-b, readiness-signals,
  ijen-health-screening-workflow, pickup/dropoff time-window-rules, payment-methods) vs data
  transaksi per-booking nyata (tidak diekstrak, dilindungi privasi).
- **docs/** — 31 file markdown audit/report internal ekosistem (data-inventory, pain-points-audit,
  duplicate-file-audit, profit-engine-requirements, dll) untuk konteks kualitas data &amp; angka yang
  sudah diverifikasi vs yang masih snapshot lama.

Sisi wa-inbox yang dibandingkan:

- **221 item managed knowledge aktif** (25 `KnowledgeSource` PUBLISHED, dibaca langsung dari
  database produksi read-only) — dibaca penuh oleh saya sendiri, bukan lewat subagent.
- **Seluruh `catalog/*.json`** (23 file, ~18.000 baris) — general-modules (77 modul), policy-cards,
  destination-guidance, package-profiles, package-variations, standard-price-tiers,
  vehicle-and-luggage-rules, guide-support-rules, accommodation-rules, component-matrices,
  module-compatibility, location-aliases, customer-link-registry, customer-media-registry,
  itinerary-intelligence/*.json (12 file: pickup/dropoff contexts, route-leg-index,
  destination-activity-profiles, operational-events, meal-logic, accommodation-logic,
  cost-components, package-route-map, recommendation-rules).

**Temuan penting soal arsitektur wa-inbox**: sebelum membandingkan, saya awalnya menyangka managed
knowledge (221 item, satu-satunya yang gampang diedit operator lewat UI) adalah representasi
lengkap "apa yang bot tahu." Ternyata **`catalog/` jauh lebih kaya** dari dugaan awal — sudah
memuat NIB, ISIC provider ID, kebijakan anti-fraud, rincian persentase pembatalan, kutipan regulasi
BBKSDA, dan harga tiket masuk yang justru **lebih update** dari beberapa file jvto-ekosistem sendiri.
Jadi gap sebenarnya adalah irisan: hal yang **tidak ada di catalog MAUPUN managed knowledge**.

---

## A. Gap nyata — layak ditambahkan (prioritas tinggi)

### A1. Batas usia keras di Kawah Ijen: 10–60 tahun, wajib bawa ID — **tidak ada di wa-inbox sama sekali**

Sumber: `1-knowledge-and-evidence-core/credentials-and-public-evidence/ijen-crater-tour-requirements.json`,
mengutip **Ministry of Forestry portal** (ayoketamannasional.kehutanan.go.id), diverifikasi 2026-08-21:
*"age limit 10–60 (strict, ID required)"*.

**Kenapa ini penting**: FAQ managed-knowledge wa-inbox saat ini (`HEALTH, AGE & REQUIREMENTS`)
menjawab pertanyaan usia dengan: *"There is no minimum age as long as the participant is
physically fit for the tour. A 17-year-old is fine..."* — **tanpa** menyebut bahwa Kawah Ijen
punya gerbang usia resmi terpisah. Kalau keluarga bertanya spesifik soal anak di bawah 10 tahun
atau lansia di atas 60 untuk paket yang mencakup Ijen, jawaban bot saat ini berpotensi menyesatkan.
Saya cek `catalog/general-modules.json` — tidak ada satu pun modul yang menyebut angka 10/60 ini.

**Rekomendasi**: tambah sebagai item baru di managed knowledge (topik `destination_readiness`,
kemungkinan digabung ke FAQ usia yang sudah ada) dan/atau catatan di `destination-guidance.json`
untuk `destinations/kawah-ijen`.

### A2. Skema FOC (grup gratis) tidak lengkap di kedua sisi wa-inbox

wa-inbox (managed knowledge & catalog) hanya punya: *"Groups of more than 18 guests get 1 free
seat (FOC)."* Sumber jvto-ekosistem (konsisten di 3 file berbeda — `pricing-rules/group-discount-foc.json`,
`organization-identity/entity-graph-schema-facts.json`, `travel-guide/booking-information.source.json`)
menyatakan skema lengkap:

- 18+ tamu bayar → 1 kursi FOC
- 35+ tamu bayar → 2 kursi FOC
- 50+ tamu bayar → 3 kursi FOC **+ diskon tambahan 5% untuk seluruh harga paket**
- Hanya berlaku booking langsung di website JVTO (bukan lewat Klook/TWT), perlu persetujuan tertulis

Saya grep `catalog/*.json` untuk pola pax 35/50 — nihil. Ini murni informasi hilang, bukan
perbedaan pendapat data.

### A3. Mekanisme "50% Recovery Fee" untuk pembatalan akibat penerbangan — ada di catalog, TIDAK terangkat jelas di managed knowledge

`catalog/policy-cards.json` (`policies/cancellation-package-credit`) sebenarnya SUDAH
menyebutnya: *"Verified flight cancellation... package can be reactivated once for a 50%
Recovery Fee."* Tapi FAQ managed-knowledge `"My flight was cancelled or delayed"` hanya
menjawab *"Rescheduling may be possible depending on availability..."* tanpa sebut mekanisme fee
ini sama sekali. Karena managed knowledge adalah lapisan yang paling sering jadi sumber jawaban
literal ke customer, sebaiknya FAQ ini diperbarui supaya konsisten dengan catalog.

### A4. "One free reschedule" jika ≥48 jam sebelum Day 1 — belum eksplisit di manapun di wa-inbox

Sumber: `1-knowledge-and-evidence-core/policies/booking-payment-cancellation.source.json`
(POL-BPC-10). Tidak ditemukan padanannya di catalog atau managed knowledge.

### A5. Urutan dokumen yang mengikat (document precedence) — belum ada di wa-inbox

Sumber (konsisten di banyak file jvto-ekosistem): E-Voucher/Invoice PDF → Kebijakan
Booking/Payment/Cancellation → Kebijakan Inclusions/Exclusions → Privacy Policy → Travel Guide.
Berguna untuk menjawab "tapi WhatsApp bilang beda" — bot bisa jelaskan dokumen resmi mana yang
berlaku duluan.

### A6. Kebijakan anti-fraud eksplisit sudah di catalog, tapi tidak muncul sebagai FAQ langsung di managed knowledge

`catalog/general-modules.json` (`policy_anti_fraud`) dan `catalog/policy-cards.json`
(`policies/anti-fraud`) sudah punya kalimat lengkap: *"JVTO never asks for full card number,
CVV, online banking password, or one-time (OTP) codes by chat or email."* Managed knowledge cuma
punya 1 FAQ sempit ("I got a payment notification from another WhatsApp number"). Karena ini
bahasan keamanan yang sensitif dan sering jadi target penipuan (jvto-ekosistem sendiri mencatat
kasus penipuan nyata: pemilik agen travel Banyuwangi ditangkap polisi atas penipuan travel fiktif,
~18 korban @ ~IDR 10 juta), sebaiknya ditambahkan sebagai FAQ eksplisit di managed knowledge agar
lebih mudah ter-retrieve saat customer bertanya soal keamanan pembayaran.

### A7. Identitas legal & kredensial usaha — nyaris tidak ada di managed knowledge

Managed knowledge cuma punya 1 baris: *"JVTO was founded and is led by an active Tourism Police
officer."* Padahal jvto-ekosistem py 14 dokumen legal terverifikasi (NIB 1102230032918, TDUP,
HPWKI, SPRIN POLPAR, NPWP, dll) dan `catalog/general-modules.json` sudah punya sebagian
(NIB, ISIC provider ID). **Tidak ada FAQ apa pun di managed knowledge yang menjawab "apakah JVTO
resmi/berizin?"** — padahal ini pertanyaan wajar dari calon customer WhatsApp yang skeptis,
apalagi setelah ada testimoni penipuan agen tak berizin. Rekomendasi: tambah 1-2 FAQ ringkas
(bukan seluruh 14 dokumen — cukup NIB/TDUP + cara verifikasi mandiri di OSS/AHU).

### A8. Rekening bank alternatif (BRI) belum ada — hanya BCA yang tercatat

Managed knowledge FAQ pembayaran internasional hanya menyebut BCA. Sumber
`narrative-claims.json` (POL-BPC-05) menyebut dua rekening: BRI (001301001779564, SWIFT
BRINIDJAXXX) dan BCA (1200944352, SWIFT CENAIDJAXXX — catatan: nomor BCA di ekosistem beda
dengan yang tersirat di managed knowledge, perlu operator konfirmasi nomor mana yang aktif
sebelum ditambahkan).

### A9. Detail rooming (kamar genap/ganjil) belum jadi aturan umum di KB

Managed knowledge hanya jawab lewat 1 contoh kasus (grup 5 orang). Aturan umumnya (dari
`luggage-and-pax-rules/vehicle-rooming-pax-rules.json`): grup genap → 1 kamar/2 tamu; grup
ganjil → 1 kamar/2 tamu + 1 extra bed di salah satu kamar; maksimal 2 tamu/kamar standar.

---

## B. Koreksi akurasi — bukan gap, tapi kesalahan yang perlu diperbaiki

### B1. wa-inbox mengutip SE.1658 padahal seharusnya SE.35 untuk syarat sertifikat kesehatan Ijen

Ini temuan paling penting dari sisi akurasi. `catalog/policy-cards.json` (`policies/ijen-health-screening`)
dan `catalog/general-modules.json` (`policy_ijen_health_screening`) **keduanya** mengutip
*"Surat Edaran SE.1658/KSA.9/2024"* sebagai dasar regulasi wajib sertifikat kesehatan.

Menurut CLAUDE.md jvto-ekosistem sendiri dan sumber paling bersih di sana
(`travel-guide/ijen-health-screening.source.json`, dan catatan `_authority_note` eksplisit di
`tours/faq-spine/tour-spine-faq.source.json` yang secara harfiah menginstruksikan "cite SE.35 not
SE.1658"): **SE.1658 mengatur pembukaan kembali kawah** (akses saat ini), sedangkan **SE.35/K2/BIDTEK.1/KSA/1/2024
adalah dasar regulasi untuk syarat sertifikat kesehatan itu sendiri**. SE.1658 hanya dikutip sebagai
otoritas pendukung akses, bukan dasar syarat kesehatan.

Catatan jujur: jvto-ekosistem sendiri **tidak konsisten** soal ini — banyak filenya sendiri
juga salah kutip SE.1658 untuk syarat kesehatan (lihat daftar 7 file yang salah kutip di laporan
mentah agen). Tapi karena sumber paling otoritatif di sana (CLAUDE.md + catatan eksplisit yang
ditulis khusus untuk mencegah kesalahan ini) mengatakan SE.35 yang benar, dan wa-inbox saat ini
100% memakai SE.1658 di kedua tempat yang mengutip nomor SE, ini layak dikoreksi.

**Ini murni perbaikan faktual berbasis bukti tertulis (bukan keputusan bisnis)** — kalau disetujui,
saya bisa eksekusi langsung: ganti "SE.1658/KSA.9/2024" → "SE.35/K2/BIDTEK.1/KSA/1/2024" di
`catalog/policy-cards.json` dan `catalog/general-modules.json`.

### B2. Harga tiket masuk Bromo/Ijen — wa-inbox JUSTRU lebih update, tidak perlu diubah

`catalog/cost-components` (lewat sub-laporan itinerary-intelligence) sudah punya angka tarif
PASCA regulasi terbaru (PP 36/2024, Okt 2024): Bromo asing flat IDR 255.000, domestik weekday
54.000/weekend 79.000; Ijen asing flat IDR 150.000, domestik weekday 20.000/weekend 30.000 —
dan secara eksplisit menandai angka lama (Bromo 220k/320k, Ijen 100-150k) sebagai **stale,
jangan dipakai**. Sebaliknya, beberapa file jvto-ekosistem sendiri (`4-operations-core/operational-events.json`,
`trip-readiness/recommendation-rules.json`) **masih pakai angka lama itu**. Tidak ada tindakan
diperlukan di wa-inbox — justru catatan ini penting untuk operator ekosistem, bukan untuk kita.

### B3. Ijen daily visitor cap ~2.000/orang/hari &amp; QRIS-only sejak Jan 2025 — sudah ada di catalog, aman

Sempat saya kira ini gap, ternyata sudah tercatat di `catalog/itinerary-intelligence/10-cost-components.json`.
Tidak perlu tindakan.

---

## C. Sengaja TIDAK direkomendasikan untuk ditambahkan

### C1. Nama kru individual + kontak pribadi (Instagram/Facebook)

jvto-ekosistem sendiri punya kebijakan `doNotPublish` di `people.json` (melarang publikasi nomor
telepon &amp; media sosial pribadi kru), tapi beberapa halaman `why-jvto/our-team-*.source.json`
justru melanggar kebijakan itu sendiri (menampilkan Instagram/Facebook kru meski telepon sudah
sengaja disembunyikan). **Saya sengaja tidak merekomendasikan menyalin data ini ke wa-inbox** —
kalaupun mau menambahkan nama kru (7 guide + 4 driver berlisensi HPWKI), sebaiknya cuma nama
depan + peran, tanpa kontak pribadi, dan ini keputusan konten yang sebaiknya operator putuskan
sendiri.

### C2. Statistik kecelakaan/kematian di Ijen

jvto-ekosistem py 2 versi angka yang saling bertentangan dalam repo mereka sendiri (5 kematian
bersumber vs 7 kejadian/4 kematian tanpa sumber) — bahkan mereka sendiri belum menyelesaikan
konflik ini. Topik ini sensitif untuk konteks layanan pelanggan; saya tidak merekomendasikan bot
customer-service pernah mengangkat topik ini secara proaktif, dan kalau ditanya langsung
sebaiknya dieskalasi ke manusia, bukan dijawab otomatis dengan angka.

### C3. Rating/jumlah review dalam angka pasti (Trustpilot 51@4.8, Google 174@4.9, dst)

Angka-angka ini terbukti cepat basi — bahkan dalam repo jvto-ekosistem sendiri ada 3 versi
berbeda (123, 147, 174) tergantung file mana yang dibaca, dan dokumentasi mereka sendiri mencatat
insiden drift 153→155 review dalam hitungan hari saat draft sedang ditulis. Kalau mau ditambahkan
ke wa-inbox, sebaiknya kalimat generik ("rating tinggi &amp; konsisten di Google, Trustpilot, dan
TripAdvisor") tanpa angka hardcoded, supaya tidak langsung basi.

### C4. Penghargaan Booking.com 2015 &amp; kutipan Stefan Loose Reiseführer

Ini konten marketing/trust-building yang sah untuk ditambahkan kalau operator mau memperkuat
jawaban "kenapa harus percaya JVTO" — tapi karena ini keputusan konten/nada suara (bukan fakta
operasional yang salah/hilang secara berbahaya), saya taruh di kategori "opsional", bukan prioritas.

---

## D. Catatan kualitas data internal jvto-ekosistem (FYI, tidak perlu tindakan di wa-inbox)

Beberapa temuan yang murni soal kualitas data di jvto-ekosistem sendiri — dicatat di sini untuk
transparansi, bukan sebagai gap untuk wa-inbox:

- Ketinggian air terjun Madakaripura diperdebatkan (100m vs 200m) di file mereka sendiri —
  wa-inbox tidak menyebut angka apa pun, jadi otomatis aman, jangan pernah menebak angkanya.
- Paket "Tumpak Sewu &amp; Bromo 3D2N (tanpa Ijen)" (id 86) sudah di-soft-delete dari situs publik
  jvto-web tapi masih ada file kontraknya di ekosistem — wa-inbox catalog SUDAH BENAR tidak
  memasukkan paket ini (16 paket aktif, cocok dengan jumlah live di jvto-web).
  Tidak ada tindakan diperlukan.
- 5D4N Bali-Ijen-Papuma-Tumpak Sewu-Bromo: hari 4 &amp; 5 di file itinerary jvto-ekosistem
  judulnya salah tempat (judul "Tumpak Sewu" tapi isinya Bromo, dst) — ini bug di jvto-ekosistem,
  tidak memengaruhi wa-inbox karena wa-inbox py teks itinerary sendiri yang berbeda &amp; sudah benar.

---

## Ringkasan prioritas eksekusi

| # | Item | Jenis | Bisa dieksekusi langsung? |
|---|------|-------|---------------------------|
| B1 | Ganti SE.1658 → SE.35 di 2 file catalog | Koreksi faktual, bukti tertulis kuat | **Ya, murni teknis** — tinggal tunggu persetujuan |
| A1 | Batas usia Ijen 10-60 | Knowledge baru, menyentuh keselamatan/compliance | Draft teks siap, tapi isi kalimat & topik penempatan perlu direview operator |
| A2 | Skema FOC lengkap (35+/50+/diskon 5%) | Knowledge baru, kebijakan harga | Draft siap, perlu approval karena ini kebijakan komersial |
| A3–A9 | 7 item lainnya | Knowledge baru / pelengkap | Draft bisa disiapkan, tapi tetap perlu review operator karena semua customer-facing |

Sesuai aturan kerja (perubahan yang menyentuh kebijakan/redaksi dokumen customer-facing wajib
approval), saya tidak langsung menulis ke `KnowledgeSource`/`catalog/*.json` untuk item A1–A9.
Untuk B1 (koreksi SE.1658→SE.35), ini murni perbaikan faktual berbasis bukti tertulis dan bisa
saya eksekusi begitu dikonfirmasi.

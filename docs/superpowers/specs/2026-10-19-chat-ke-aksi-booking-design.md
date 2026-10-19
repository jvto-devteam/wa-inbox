# Chat → Aksi Booking — Desain

Tanggal: 2026-10-19 · Status: disetujui konsepnya oleh owner di percakapan; dokumen ini menunggu review owner.

## 1. Maksud dan alasannya

Hari ini percakapan WhatsApp berhenti di wa-inbox: data booking tampil, bot menjawab, lalu selesai.
Kalau tamu menulis "pickup pindah dari Surabaya Airport ke hotel", admin harus **ingat sendiri**
untuk mengubahnya di new-backoffice. Kalau lupa, driver datang ke tempat yang salah.

Owner ingin chat **terhubung ke data booking**: setiap hal di chat yang berarti perubahan atau
ketidaksesuaian **langsung disiapkan jadi tindakan**, admin hanya **memutuskan** (approve + klik
eksekusi), dan **setiap kejadian tercatat**.

Kalimat owner yang jadi pegangan: *"tidak hanya berhenti di wa inbox dan data ditampilkan lalu
sudah, tidak ada action apa-apa. Aku ingin semuanya dapat terkoneksi, terhubung dan ter-record."*

## 2. Tujuan, bukan tujuan, anti-tujuan

**Tujuan**
1. Setiap pesan masuk dari tamu yang punya booking mendatang dibaca **saat itu juga** untuk
   menemukan (a) permintaan perubahan dan (b) fakta yang bertentangan dengan booking.
2. Perubahan field ringan/sedang disiapkan sistem sebagai **kartu usulan** yang tinggal disetujui.
   Per jenis perubahan, setelan **Minta persetujuan** (admin klik Setujui) atau **Selalu izinkan**
   (sistem langsung menerapkan, admin diberi tahu dan bisa Batalkan). Penerapan menulis ke new-backoffice.
3. Ketidaksesuaian muncul sebagai **peringatan**, dan tertutup sendiri begitu data booking cocok.
4. Perubahan berat jadi **tugas ops lengkap dengan dampaknya**, tertutup sendiri begitu booking berubah.
5. Data booking yang kurang/samar menjelang hari H menghasilkan **draf pesan ke tamu** yang
   admin kirim; jawabannya kembali ke tujuan 1.
6. **Riwayat lengkap** untuk semua usulan, peringatan, tugas, dan eksekusi.
7. **Mobile-first.** Semua layar baru dirancang untuk HP dulu (satu jempol, tombol besar).
8. **PWA + notifikasi push** ke admin untuk setiap kejadian yang perlu dilihat (§5.10).

**Bukan tujuan (keputusan owner)**
- Perubahan **besar** (tanggal, pax, hotel menginap) tidak pernah diterapkan otomatis; selalu jadi tugas ops.
- Penagihan sisa bayar: **sudah ada di cron job** (kata owner).
- Pengingat ke crew/driver/guide sesudah perubahan: **sudah ada di cron job** (kata owner).
- Edit booking manual oleh admin langsung dari Inbox: **belum perlu**.
- Arsitektur multi-agent/A2A: dibahas dan dibuang; ini satu aplikasi, satu proses.
- Review sesudah trip, pelacakan delay pesawat, statistik/dashboard bacaan.

**Anti-tujuan (gagal walau secara teknis jalan)**
- Eksekusi mengubah **booking yang salah** (tamu dengan dua booking).
- Peringatan palsu yang terus muncul sampai admin berhenti membacanya.
- Peringatan/tugas/pengingat yang memakai **salinan lama** data booking dan berbohong
  sesudah booking diubah.
- Balasan bot ke tamu jadi lebih lambat karena fitur ini.
- Ada kejadian yang hilang tanpa jejak.
- Lapisan persetujuan kosong ala fase A–H (lihat CLAUDE.md §3). Di sini konfirmasi **sah**:
  pengusul (LLM) dan pemutus (manusia) adalah dua pelaku berbeda.

## 3. Batasan

- Semua aturan `CLAUDE.md` (single-tenant, larangan `any`, aturan API §6, migrasi §7, verifikasi §9).
- LLM produksi `gemma4:31b-cloud` memproses teks di ollama.com; teks tamu dan potongan booking
  memang sudah keluar VPS hari ini. **Kirim ke model hanya field yang diperlukan** untuk ekstraksi
  (pickup/dropoff, jam, tanggal, pax, hotel, nomor flight), **bukan** `financial`, `expense`, atau
  `paymentHistory`.
- Test hanya ke nomor whitelist (memori: `6282143403501`), tidak pernah ke tamu sungguhan.
- WhatsApp di luar jendela 24 jam hanya bisa template; draf pesan ke tamu harus memperhitungkannya
  (pola peringatan jendela sudah ada di commit `459aab2`).

## 4. Kondisi sekarang (terverifikasi di kode, 2026-10-19)

**wa-inbox**
- Booking diambil dari `BOOKING_API_URL` (`/booking-overview/api`) dengan `phone_no`
  (`src/lib/booking/client.ts:146`), disimpan mentah ke `Conversation.bookingData`, disegarkan
  oleh tick 5 menit (`refreshStaleBookingData`).
- Bot hanya jalan bila `Conversation.botEnabled` (`src/lib/inbound.ts:389`). Chat yang diambil
  alih admin dan nomor Indonesia (bila `skipBotForIndonesianNumbers`) **tidak dibaca LLM**.
- `SummaryItem` **unik per percakapan** (`conversationId @unique`), jenis REPLY/FOLLOW_UP/PROMISE.
- **Belum ada kode yang menulis ke backoffice.**

**new-backoffice**
- `GET /booking-overview/api` **tanpa auth** (`routes/web.php:75`, di luar grup `auth`).
  Dengan `phone_no`, mengembalikan **satu** booking (`ScheduleController.php:398`, `->first()`).
- Respons memuat (`ScheduleController.php:274-345`): `booking_id`, `id` (mis. `JVTO-123`),
  `total_pax`, `date.{start_ymd,end_ymd}`, `pickup.{meeting_point, meeting_point_arrival,
  meeting_point_value, pickup_time, text}`, `dropoff.{drop_point, drop_point_arrival,
  drop_point_value, drop_time, text}`, `itinerary`, `hotels`, `tshirtSize`, `tshirtRaw`,
  `vehicles`, `drivers`, `guides`, `is_shuttle`, `at_ijen`, `financial`.
- `pickup_time`/`drop_time` dikirim lewat `date("H:i", strtotime(...))`. **Dugaan (belum
  diuji):** jam kosong bisa tampil sebagai jam palsu, bukan null. Builder wajib memastikan
  sebelum membandingkan jam; kalau benar, perlu diperbaiki di backoffice atau dianggap "tidak diketahui".
- Jalur tulis yang ada, semua butuh **session login web**, belum ada jalur token:
  - `POST /bookings/quick-update/{id}` (`BookingController.php:2663`): `pickupLocation` (JSON
    `{location, terminal, station, ticketNumber, hotelName, customLocation}`), `pickupTime`,
    `dropLocation` (bentuk sama), `dropTime`, `sizes`.
    Nilai `location` yang dikenali: `Surabaya Airport`, `Denpasar Airport`,
    `Surabaya Train Station`, `Surabaya Hotel`, `Bali Hotel`, `Others`.
  - `POST /update-booking-note` (`booking_id`, `note`, `category_id`).
- Cek kesiapan (`hasPickup`, `hasDropoff`) hanya memeriksa **ada/tidak**
  (`ScheduleController.php:266-267`); pickup "Others" tanpa detail atau dropoff tanpa jam tetap lolos.
- Penjadwal Laravel new-backoffice (`routes/console.php`) hanya memuat `wa:generate-daily-summaries`
  dan `bca:sync-transfers`.

**javavolcano-touroperator** (repo website; tempat cron pengingat menurut owner)
- `app/Console/Kernel.php` menjadwalkan tiap menit, antara lain: `my:trip-information`,
  `my:trip-reminder-crew`, `my:trip-itinerary-crew`, `my:reminder-payment`, `my:reminder-bali`.
- Dugaan (belum diperiksa): karena jalan tiap menit, perintah-perintah ini membaca database saat
  kirim, sehingga perubahan booking otomatis terbawa. Builder wajib memastikan isi perintahnya (§5.9).

## 5. Bentuk sistem

### 5.1 Prasyarat (harus ada sebelum tombol eksekusi hidup)

**P1. Booking yang dituju terlihat jelas.**
Daftar booking per nomor HP **tidak dibuat** (keputusan owner 2026-10-19: "tidak perlu").
Eksekusi menulis ke `booking_id` yang sedang ada di `Conversation.bookingData`. Sebagai pengaman,
kartu selalu menampilkan **kode booking dan tanggal trip** tepat di atas tombol Eksekusi, dan
`booking_id` itu ikut tercatat di riwayat. Risiko yang diterima owner: tamu dengan lebih dari satu
booking bisa tertaut ke booking yang dikembalikan backoffice (`->first()`); admin melihatnya dari
kode dan tanggal di kartu.

**P2. Jalur tulis: memakai jalur my-booking tamu yang sudah ada (keputusan Claude, disetujui owner 2026-10-19).**
- Legacy `POST /bookings/update-pickup/{url}`, `update-drop/{url}`, `update-tshirt/{url}`
  (`UserBookingsController.php:752`, `:802`, `:711` pada `b68454ad`; cek ulang di `origin/main` sebelum dibangun), dikunci oleh `url` booking yang ada di
  `bookingData.customer_portal` (`…/my-booking/{url}`). Field pickup: `meeting_point`,
  `flight_ticket_type_number`, `hotel`, `train_ticket_type_number`, `others_location`,
  `pickup_time1`/`pickup_time2`. Keduanya memanggil `EcosystemSync::notify`.
- Celah yang diketahui: `updatePickup` tidak mengisi `meeting_point_arrival` (terminal); isi
  `updateDrop` belum dibaca utuh (builder wajib membacanya); endpoint tanpa autentikasi selain `url`.
- Catatan booking tidak punya jalur di my-booking; itu satu-satunya tambahan yang berguna dari backoffice.
- Tidak ada yang wajib dibuat owner sebelum Fase 2.

**Keamanan (di luar repo ini, dilaporkan ke owner 2026-10-19):** `/booking-overview/api` tanpa login;
webhook Xendit **sudah** diverifikasi di `origin/main` `cca8dab5` (`XenditWebhookVerifier`: token +
status PAID/SETTLED dari API Xendit), tetapi hanya menolak bila `XENDIT_WEBHOOK_ENFORCE=true` (default
`false` = log-only) — nilai produksinya belum diperiksa; jalur update my-booking tanpa kunci; pengecekan harga checkout hanya bila
`CHECKOUT_PRICE_ENFORCE=true`.

### 5.2 Ekstraksi per pesan (real time)

Setiap pesan **masuk** dari kontak yang punya booking mendatang (trip belum selesai), **terlepas
dari `botEnabled`**, memicu **satu panggilan LLM khusus ekstraksi**. **Nomor Indonesia
(`isIndonesianNumber`, `src/lib/phone.ts`) selalu dikecualikan**, terlepas dari setelan
`skipBotForIndonesianNumbers` (keputusan owner 2026-10-19: "nomor indo tetap tidak termasuk").
Pengecualian yang sama berlaku untuk draf permintaan data (§5.7).
- Terpisah dari balasan bot dan berjalan di latar belakang; balasan bot tidak menunggu.
- Masukan: beberapa pesan terakhir (bernomor, pola `buildNumberedTranscript`) + field booking yang
  relevan saja (lihat §3).
- Keluaran terstruktur (divalidasi Zod, item cacat dibuang satu-satu, pola `parseReview`):
  - `perubahan[]`: field, nilai baru, pesan sumber.
  - `fakta[]`: hal yang dinyatakan tamu tentang tripnya (jumlah orang, jam landing, nomor flight,
    nama hotel, tanggal), dengan pesan sumber.
- Pesan reaksi/penutup (`isNoiseMessage`) tidak memicu panggilan.
- Gagal/timeout: tidak ada kartu, kegagalan tercatat, tidak ada retry berantai.

### 5.3 Pembagian perubahan (keputusan owner 2026-10-19, berdasarkan penelusuran checkout + webhook)

Bukti (dibaca 2026-10-19, baca-saja):
- Checkout jvto-web (`src/app/(api)/api/checkout/route.ts` → legacy `Api/Web/CheckoutController::checkout`)
  tidak mengisi titik jemput; harga = tier pax × pax − FOC + add-on.
- Webhook Xendit DP (legacy `thirdParty/XenditController::invoiceSuccess`) membuat itinerary, hotel,
  kamar, expense, `at_bondowoso`, dan WA reservasi hotel / transport Bali **sekali**, dari paket + pax +
  tanggal, **tidak** dari titik jemput. Tidak ada yang dihitung ulang saat booking diubah.
- Tamu sendiri sudah bisa mengganti titik/jam jemput di my-booking (legacy
  `UserBookingsController::updatePickup`, `routes/web.php:129`); hanya kolom pickup yang berubah, lalu
  `EcosystemSync::notify`.

| Kelompok | Field | Hasil |
|---|---|---|
| **AI bisa ubah** | titik jemput/antar di Surabaya (`Surabaya Airport`, `Surabaya Hotel`, `Surabaya Train Station`, `Others`), detail hotel/flight/kereta, terminal, jam jemput & antar, ukuran kaos, catatan | Kartu usulan → Setujui / Selalu izinkan |
| **AI ubah + kabari vendor Bali** | jam/titik antar pada booking yang memakai transport Bali (paket mulai Bali atau add-on transport Bali) | Sama, lalu sistem mengirim info terbaru ke vendor transport Bali (vendor hanya dikabari sekali saat DP, `internal_bali_transport` di `XenditController::invoiceSuccess`) |
| **Tugas ops** | pindah start Surabaya ↔ Bali (`Denpasar Airport`, `Bali Hotel` = ganti paket), tanggal trip, pax, hotel menginap | Tugas dengan dampak, tidak pernah diterapkan otomatis |

### 5.3a Permintaan tamu tidak pernah hilang (keputusan owner 2026-10-19)

Setiap permintaan perubahan dari tamu, **kelompok apa pun**, langsung:
1. dinotifikasi ke admin (push, §5.10),
2. tercatat (§5.8),
3. memberi label **"Permintaan perubahan · belum dipenuhi"** pada percakapan di daftar Inbox dan di antrean.

Label dan kartunya hanya hilang bila: data booking sudah sesuai (otomatis), perubahan diterapkan, atau
admin menandai **Selesai** / **Tidak perlu** (dengan catatan opsional; tercatat dengan nama admin). Tidak
ada kedaluwarsa.

### 5.4 Kartu usulan perubahan

- Tampil di panel booking Inbox dan di antrean `/summary`, mobile-first.
- Isi: field, nilai lama → nilai baru (lama dibaca dari `bookingData` **terbaru**), link ke pesan
  sumber (`/inbox?conversation=…&message=…`).
- Aksi admin: **Setujui** (bisa mengoreksi isian dulu), **Tolak** (dengan alasan opsional).
- **Setelan persetujuan (keputusan owner 2026-10-19, menggantikan "admin yang proses terapkan"):**
  kolom di `Settings`, diedit di `/settings`, berlaku seketika (edit → simpan → aktif, CLAUDE.md §3).
  Tiga sakelar, masing-masing `APPROVE` atau `ALWAYS`: perubahan ringan, perubahan sedang (default
  `APPROVE`), dan pesan permintaan data (§5.7) dengan default **`ALWAYS`** (keputusan owner 2026-10-19:
  "pesan permintaan data selalu izinkan"). Perubahan besar tidak punya sakelar. Mengubah setelan ini mengubah
  apa yang dilakukan sistem, jadi lewat `hasAdminPowers()` dan `writeBotAuditLog`.
- Mode `ALWAYS`: kartu dibuat lalu langsung diterapkan oleh sistem (actor `SYSTEM`). Kartu tetap
  tampil sebagai pemberitahuan "diterapkan otomatis" dengan tombol **Batalkan**, yang menulis
  kembali nilai lama lewat jalur yang sama dan tercatat sebagai `REVERTED`. Gagal menerapkan →
  kartu kembali menjadi usulan biasa yang menunggu Setujui.
- **Siapa yang boleh eksekusi/tolak: semua akun yang login**, ADMIN maupun AGENT (keputusan
  owner 2026-10-19: "siapa saja yang penting punya akun"). Ini **pengecualian** dari langkah
  `hasAdminPowers()` di CLAUDE.md §6, sejenis pengecualian `POST /api/inbox/decisions/[id]/fix`.
  Alasannya sama: setiap eksekusi tercatat lengkap dengan nilai lama sehingga bisa dibalik. Saat
  dibangun, pengecualian ini wajib ditambahkan ke §6 CLAUDE.md.
- Eksekusi: panggil jalur tulis P2 → simpan jawaban backoffice → segarkan `bookingData`
  → catat. Gagal → kartu tetap terbuka dengan pesan gagal, bisa dicoba lagi.
- Kartu yang tidak disentuh tetap di antrean sampai ditutup. Tidak ada kedaluwarsa diam-diam.
- Usulan yang nilainya sudah sama dengan booking (misalnya admin mengubah langsung di backoffice)
  tertutup sendiri dengan alasan "sudah sesuai di backoffice".
- Usulan baru untuk field yang sama menggantikan yang lama (yang lama tertutup "digantikan").

**Ke mana perubahan mengalir sesudah eksekusi.** Tidak ada sinkronisasi yang perlu dibangun;
semua aplikasi membaca sumber yang sama:
- new-backoffice, website javavolcano-touroperator (portal customer `/my-booking/{url}`), dan
  crew-portal memakai database `jvto` (dari `.env` lokal ketiga repo; `.env` produksi belum
  diperiksa — dicek di Task 13).
- sam-app membaca API new-backoffice.
- `quickUpdate` memanggil `EcosystemSync::notify` (repository_dispatch `booking-changed` ke
  jvto-ekosistem), jadi jalur tulis ber-token harus tetap memanggilnya.

### 5.5 Peringatan ketidaksesuaian

- `fakta[]` dari 5.2 disimpan. Perbandingan fakta ↔ booking adalah **kode biasa, bukan LLM**,
  dijalankan (a) saat fakta baru masuk dan (b) setiap kali `bookingData` disegarkan.
- Contoh: tamu "kami berlima" vs `total_pax` 4; "landing 14.00" vs `pickup_time` 10.00; nomor
  flight di chat ≠ `meeting_point_value`.
- Tertutup sendiri bila data cocok, atau ditutup admin ("chat yang salah, booking benar").
- Fakta yang lebih baru dari tamu menggantikan fakta lama untuk hal yang sama.

### 5.6 Tugas perubahan berat

- Permintaan tingkat "berat" jadi tugas ops: apa yang diminta, pesan sumber, dan **dampak** yang
  dihitung dari data jadwal (crew yang bentrok di tanggal baru, malam hotel yang terdampak, tanggal
  medical checkup Ijen yang bergeser). Sumber data jadwal: `internal-api` new-backoffice
  (`/internal-api/bookings/{id}`, `/internal-api/medical-checkups`, crew), dibaca saat ditampilkan.
- Tertutup sendiri begitu `bookingData` menunjukkan nilai yang diminta.

### 5.7 Draf penagihan data ke tamu

- Booking mendatang dengan data kurang/samar (pickup `Others` tanpa detail, jam pickup/drop kosong,
  nomor flight kosong padahal titiknya bandara) menghasilkan **draf pesan** di antrean.
- **Jadwal (keputusan owner 2026-10-19):** mulai **H-7**, lalu **setiap hari** sampai datanya
  lengkap atau trip dimulai. Satu draf terbuka per booking per hari. Draf hari kemarin yang belum
  dikirim digantikan, bukan ditumpuk. Draf berhenti dibuat begitu `bookingData` menunjukkan data
  sudah lengkap.
- Dikirim setelah admin klik Setujui, atau otomatis bila sakelar pesan permintaan data `ALWAYS`
  (pengiriman otomatis hanya di dalam jendela 24 jam; di luar itu menunggu template). Di luar jendela 24 jam, draf harus berupa template WhatsApp yang sudah
  disetujui Meta. Kalau template itu belum ada, membuat dan mengajukannya adalah tindakan owner di
  luar kode. Sampai template ada, draf hanya dibuat untuk percakapan yang jendelanya masih terbuka.
- Jawaban tamu masuk lewat 5.2 dan jadi kartu usulan.

### 5.8 Riwayat (record)

Setiap kejadian dicatat append-only, per booking dan per percakapan:
- usulan dibuat / dikoreksi / dieksekusi / ditolak / digantikan / tertutup sendiri
- jawaban backoffice (sukses/gagal) untuk setiap eksekusi
- peringatan muncul / tertutup (dengan alasan)
- tugas dibuat / tertutup

Setiap catatan memuat: kapan, siapa (bot / akun admin / sistem), apa, nilai lama → baru,
pesan sumber, alasan. Riwayat bisa dilihat di panel booking Inbox.

### 5.9 Aturan baca data terbaru

Tidak ada peringatan, tugas, kartu, atau pengingat yang menyimpan **salinan** data booking sebagai
kebenaran. Nilai "lama" di kartu dibaca dari `bookingData` terbaru saat ditampilkan dan saat eksekusi.
Pengingat cron yang sudah ada (`my:trip-reminder-crew`, `my:reminder-payment`, dan seterusnya di
javavolcano-touroperator) harus dipastikan membaca data saat kirim. Kalau ada yang memakai salinan,
perbaikannya masuk rencana.

### 5.10 Mobile first, PWA, dan notifikasi ke admin (keputusan owner 2026-10-19)

- **Mobile first:** setiap layar baru dirancang untuk lebar HP dulu (satu kolom, tombol ≥ 44 px).
- **PWA:** manifest sudah ada (`src/app/manifest.ts`, `display: 'standalone'`), tetapi **belum ada
  service worker**. Service worker ditambahkan, minimal untuk menerima push dan membuka kartu saat
  notifikasi diketuk. Halaman tetap berjalan normal di browser biasa.
- **Notifikasi:** sekarang hanya `NotificationListener` (`src/components/NotificationListener.tsx`)
  yang memunculkan `new Notification` dari SSE untuk `handoff.alert`, dan **hanya selama tab
  terbuka**. Ditambah **Web Push** supaya notifikasi masuk walau aplikasi tertutup (iPhone: setelah
  wa-inbox dipasang ke layar utama).
- **Kapan dikirim:** usulan perubahan baru, ketidakcocokan baru, tugas perubahan besar baru,
  penerapan otomatis (`ALWAYS`) beserta tombol Batalkan, dan penerapan yang gagal. Ketuk notifikasi
  → `/inbox?conversation=…` dengan kartu terkait terbuka.
- **Penerima (keputusan Claude):** semua akun yang menyalakan notifikasi di perangkatnya; satu akun
  bisa punya beberapa perangkat. Isi notifikasi memuat kode booking dan ringkasan perubahan, tanpa
  nomor HP atau email tamu.

### 5.11 Panel kanan chat selalu terbaru (keputusan owner 2026-10-19)

Tab "Ringkasan chat" (`src/components/inbox/ChatReviewTab.tsx`, CLAUDE.md §4) sudah memuat pertanyaan
(✓/⏳), poin penting, janji tim, dan riwayat per hari, tetapi hanya diperbarui oleh job 00.00 atau tombol
"Perbarui sekarang" (`POST /api/conversations/[id]/chat-review`, cooldown 30 s). Perubahan:
- **Diperbarui otomatis** sesudah pesan masuk, memakai jalur yang sama dengan tombol "Perbarui sekarang"
  (`reviewConversation` → `saveChatReview` → `applyReviewToItem`), dipicu dari pemicu §5.2 dengan
  **jeda minimal 5 menit per percakapan** (keputusan Claude: satu review = satu panggilan LLM besar,
  timeout 60 s; jeda menjaga biaya dan antrean model). Pesan yang datang selama jeda ikut terbaca di
  review berikutnya.
- **Bagian "Disematkan" di paling atas**: `BookingAction` OPEN jenis CHANGE/TASK (label "belum dipenuhi")
  dan MISMATCH, dibaca live dari tabel aksi, bukan dari LLM review.
- **Bagian "Riwayat perubahan"**: `BookingActionEvent` per booking (EXECUTED/REVERTED/MARKED_DONE…).
- Pengecualian nomor Indonesia sama dengan §5.2 untuk pembaruan otomatis; tombol manual tetap ada.

## 6. Yang diserahkan ke builder

- Skema tabel baru (usulan, fakta, peringatan, tugas, riwayat), dengan catatan bahwa
  `SummaryItem` unik per percakapan sehingga item jenis baru **tidak bisa** sekadar jadi `kind`
  tambahan tanpa mengubah batas itu.
- Cara antrean `/summary` menampilkan jenis item baru tanpa mengubah tiga jalan keluar yang sudah ada.
- Prompt ekstraksi, panjang konteks pesan, dan golden case di `npm run eval`.
- Desain layar mobile kartu, peringatan, tugas, dan riwayat.
- Apakah ekstraksi juga membaca pesan **keluar** admin ("baik, kami ubah ke jam 9") untuk menutup usulan.
- Retensi riwayat (bandingkan 30 hari untuk SummaryItem; riwayat perubahan booking mungkin perlu lebih lama).

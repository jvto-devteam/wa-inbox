# wa-inbox — Project Rules (WAJIB)

Dokumen ini adalah **konstitusi pengembangan** wa-inbox. Ia menggambarkan sistem
**sebagaimana adanya sekarang**, bukan sistem yang pernah direncanakan.

Terakhir disesuaikan dengan kode: **2026-09-08** (refactor right-sizing Bot Control).

---

## 1. Apa itu wa-inbox

Inbox WhatsApp + chatbot **internal milik satu bisnis**: Java Volcano Tour Operator (JVTO).
Single-tenant, satu tim kecil, satu database, satu deployment. **Bukan SaaS, tidak akan
pernah menjadi SaaS.** Setiap keputusan desain di bawah ini turun dari fakta itu.

Konsekuensi yang harus dipegang setiap agen:

- **Jangan usulkan multi-tenancy**, workspace, organisasi, atau pemisahan tenant.
- **Jangan usulkan visual flow builder.**
- Jangan membangun mekanisme yang jawabannya adalah "supaya tenant A tidak bisa melihat/
  mengubah punya tenant B" atau "supaya bisa dibuktikan ke pihak ketiga". Tidak ada tenant
  lain dan tidak ada pihak ketiga.

## 2. Stack Teknologi

Next.js 16 App Router, React 19, TypeScript, Prisma 7, PostgreSQL, Tailwind v4, Vitest.
LLM dipanggil lewat daemon Ollama di VPS yang sama, tanpa penyedia hosted lain (OpenAI dkk).
**Model produksi saat ini, `gemma4:31b-cloud`, adalah tag cloud:** daemon meneruskan inferensi
ke server ollama.com, jadi teks pelanggan — dan data booking di Mode 3 — **keluar dari VPS**
untuk diproses di sana. Hanya tag model lokal (tanpa `-cloud`) yang menjaga inferensi tetap di
mesin. Terverifikasi 2026-09-10 lewat `/api/tags` produksi (`remote_host: https://ollama.com:443`).

---

## 3. Prinsip Inti: edit → simpan → aktif

**Pola default untuk semua konfigurasi adalah edit → simpan → langsung berlaku.**
Operator mengubah sesuatu, menekan simpan, dan perubahannya aktif. Titik.

Alur berlapis (draft → review → approve → publish → rollback) **hanya dibenarkan kalau ada
dua orang berbeda yang benar-benar bisa memegang peran berbeda.** Kalau penulis draft dan
penyetujunya pasti orang yang sama, lapisan itu bukan kontrol — ia hanya klik tambahan yang
membuat perubahan tertahan tanpa ada yang menahannya.

### Bukti historisnya (jangan sampai hilang)

Repo ini pernah membangun lapisan itu secara penuh, fase A–H, untuk rule, flow, knowledge,
channel policy, dan test suite. Audit produk pada 2026-09-08 membatalkannya dengan dua bukti
yang menentukan:

1. **Tak seorang pun bisa memegang peran selain `ADMIN` atau `AGENT`** (lihat
   `src/app/api/accounts/route.ts`). Matriks izin lima peran itu mendeskripsikan akun yang
   tidak bisa dibuat siapa pun. Setiap "approval" adalah orang yang menyetujui paragrafnya
   sendiri, satu klik setelah menulisnya.
2. **Tombol Publish mengembalikan 409 di setiap penekanan.** Fitur inti dari seluruh fase
   itu tidak pernah sekali pun berhasil dijalankan, dan tidak ada yang melaporkannya —
   karena tidak ada yang benar-benar membutuhkannya.

Yang tersisa setelah refactor: konfigurasi jadi kolom biasa di `Settings`, disimpan langsung
dari form. Knowledge menyisakan dua status yang dipilih operator (`DRAFT` / `PUBLISHED`)
karena versioning-nya memang menjawab pertanyaan nyata ("apa yang bot ketahui tanggal itu"),
bukan pertanyaan persetujuan.

**Jangan bangun ulang lapisan itu.** Kalau suatu saat JVTO benar-benar punya dua peran
terpisah yang dipegang dua orang berbeda, diskusikan dulu — jangan mulai dari kode.

---

## 4. Peta Sistem Saat Ini

### Konfigurasi bot (`Settings`, satu baris, id=1)
Semua diedit di `/chatbot` atau `/settings`, tersimpan langsung:

- `botAutoReplyAll`, `skipBotForIndonesianNumbers` — mode bot global.
- `handoffOnHumanRequest` — sakelar lapisan eskalasi LLM. Gerbang keyword di
  `escalation-classifier.ts` **tidak** di belakang sakelar ini.
- `fallbackReply`, `handoffReply` — dua kalimat yang boleh diubah tanpa deploy. Kosong =
  pakai default di kode, **bukan** "jangan bicara".
- `workingHoursStart` / `End` / `offHoursAutoReply` — zona **`Asia/Jakarta`** selalu (VPS
  jalan UTC). Fungsinya **hanya satu**: menambahkan satu kalimat pada pesan handoff di luar
  jam kerja. **Bot tetap menjawab 24/7**; jangan pernah memakai jendela ini untuk
  mendiamkan bot.
- `campaignRatePerMinute`, `duplicateWindowMs`, `providerFailureThreshold`,
  `providerFailureWindowMs` — pengaman outbound. Batas min/max di
  `src/lib/outbound/safety-bounds.ts` **wajib ditegakkan sebagai Zod** di
  `PATCH /api/settings`. Nol pada angka-angka ini tidak "melonggarkan" gerbang, ia
  **mematikannya**.
- `pausedProviders` — **sengaja di luar** `PATCH /api/settings`. Hanya ditulis
  `/api/outbound-jobs/pause-provider` dan `resume-provider`; jeda darurat tidak boleh bisa
  terangkat oleh penyimpanan setelan yang tidak berhubungan.
- `defaultChannel` — **satu-satunya** sumber kebenaran default channel outbound.

### Knowledge
- `KnowledgeSource` (selalu `type='MANUAL'`) + `KnowledgeRevision` (versi naik per sumber).
- Status revisi: `DRAFT` dan `PUBLISHED` dipilih operator; **`ARCHIVED` ditulis sistem**,
  bukan dipilih operator — loader (`src/lib/bot/managed-knowledge.ts`) membaca **semua**
  baris `PUBLISHED` tanpa dedup, jadi revisi lama harus diturunkan otomatis saat yang baru
  aktif.
- Revisi `PUBLISHED` **immutable**. Setiap perubahan = revisi baru.
- Katalog (`catalog/*.json`) dibaca langsung dari file dan digabung dengan managed knowledge
  **saat baca**, tidak pernah dicerminkan ke tabel.

### Registry statis (kode, bukan DB)
`rule-registry.ts`, `existing-flow-registry.ts` (28 node), `channel-capabilities.ts`.
Halaman `/bot-control/rules` dan `/bot-control/flows` **read-only** terhadap registry ini.

### Audit log
`BotControlAuditLog`, lima hal: kapan, siapa, aksi (`UPDATE`/`PUBLISH`/`ENABLE`/`DISABLE`),
entitas, alasan. **Tidak ada `before`/`after`, `ipAddress`, atau `userAgent`.**
`reason` adalah teks bebas dan **wajib** lewat `sanitizeTrace` saat **tulis**.
Dipangkas otomatis setelah 365 hari lewat `pruneBotAuditLogs()`, dipanggil dari
`POST /api/summary-items/tick` (crontab VPS tiap 5 menit; juga masih di
`POST /api/outbound-jobs/process`, yang tidak punya cron di produksi).

Ditulis hanya untuk perubahan pada **apa yang bot lakukan**. Draft, flag, dan pekerjaan
setengah jadi tidak dicatat.

### Outbound
`OutboundJob` + worker + retry ladder (`retry-policy.ts`) + safety guard + stuck recovery.
Definisi "macet" ada di **satu tempat**: `src/lib/outbound/stuck.ts` — dipakai bersama oleh
recovery di worker dan filter di halaman Outbound Queue. Kalau dua tempat mendefinisikannya
sendiri-sendiri, halaman berbohong tentang tombol di sebelahnya.

### Email (Gmail)
`MailAccount` (satu baris per kotak surat JVTO, disambungkan lewat OAuth di Pengaturan → Kotak
surat email). `refreshToken` **tidak pernah** keluar ke UI/API/log. Satu thread Gmail = satu
`Conversation` (`externalThreadId` = threadId, `mailAccountId` = kotak surat yang disurati;
balasan keluar dari alamat itu). Masuk lewat dua lapis: push Pub/Sub `POST /api/webhooks/gmail`
(bel pintu, token di query; project GCP `jvto-wa-inbox`) dan crontab VPS `*/15`
`POST /api/email/sync` yang **sekaligus memperpanjang `watch()`** (mati tiap 7 hari).
**Bot tidak pernah menjawab email** — draf manual saja; tidak ada sakelar bot Email.
`Conversation.mailAutomated` menandai benang dari pengirim mesin (label, bukan gerbang):
email tetap masuk, hanya daily summary yang tidak mengumpulkannya. Kode di `src/lib/gmail/`.

### Decision log & triage
`BotDecisionRun` + trace viewer + popover di Inbox. Triage = dua kolom `flaggedAt` /
`flagNote` pada baris yang sama, bukan tabel tersendiri.

### Summary harian (`/summary`)
`DailySummary`, satu baris per hari WIB, payload JSON (`src/lib/daily-summary/payload-schema.ts`).
Dibuat `POST /api/daily-summary/generate` (crontab VPS `0 0 * * *` — jam sistem VPS Asia/Jakarta, header
`x-cron-secret`; atau admin lewat tombol "Buat ulang"). Satu panggilan LLM per percakapan
(model `Settings.ollamaModel`, timeout 60 s) yang meringkas **dan** menyaring kandidat "belum
dibalas"/"pelanggan diam" yang sudah selesai. Ambang di `src/lib/daily-summary/config.ts`.
Dipangkas setelah **30 hari** per `date` (keputusan owner 2026-09-22) — payload memuat nama
dan cuplikan chat pelanggan.

Halamannya **antrean tindakan**, bukan laporan bacaan (permintaan bos 2026-10-18: data tidak
boleh berhenti di halaman). Kandidat disinkronkan ke `SummaryItem` (satu baris per percakapan,
`src/lib/summary-items/sync.ts`); item yang belum tertutup terbawa ke hari berikutnya. Setiap
item hanya punya tiga jalan keluar: tertutup otomatis oleh `reconcileSummaryItems` (dipanggil tick
`POST /api/summary-items/tick` dan saat daftar dibaca), dijadwalkan lewat `Reminder`, atau
dilepas dengan catatan. Jangan tambahkan kembali tab bacaan atau statistik tanpa tindakan.

**Antrean live**: `POST /api/summary-items/tick` (crontab VPS `*/5 * * * *` = tiap 5 menit,
`/usr/local/bin/wa-inbox-summary-tick.sh` = `scripts/wa-inbox-summary-tick.sh`, header `x-cron-secret`,
log `/var/log/wa-inbox-summary-tick.log`) menjalankan, berurutan: kebersihan yang dulu hanya ada di
`/api/outbound-jobs/process` (`pruneBotAuditLogs`, `advancePipelineStagesFromBooking`,
`refreshStaleBookingData` — tahap pipeline naik sebelum reconcile supaya STAGE_ADVANCED tertutup di tick
yang sama), lalu `reconcileSummaryItems`, lalu `createLiveReplyItems` — **tanpa LLM**, dan tanpa
`processDueOutboundJobs`. Tick yang tumpang tindih dicegah `flock -n` di skrip dan single-flight di
route (`{ busy: true }`); penyegaran data booking dibatasi 60 s dan 25 percakapan per tick, diacak dari
100 yang paling basi supaya yang terus gagal tidak menahan sisanya, dan API booking yang gagal
(timeout/non-OK/error) **tidak pernah** menghapus `bookingData` atau menstempel `bookingCheckedAt` —
hanya jawaban kosong yang sah yang berarti "tanpa booking". Rangkaian pesan pelanggan sesudah balasan
terakhir kita yang pesan **pertamanya** sudah ≥ `UNREPLIED_MIN_MS` (pesan terakhir INBOUND,
≤ `LOOKBACK_MS`) langsung jadi REPLY tanpa menunggu 00:00. Aturan REPLY satu untuk live, sync malam,
dan reconcile: `anchorAt` = pesan masuk **pertama** rangkaian dan tidak pernah maju selama item terbuka;
`coveredUntil` + snippet = pesan masuk **terbaru** yang sudah tercakup kartu — keduanya selalu bergerak
bersama dan tidak pernah mundur (sync malam tidak memundurkan baris yang sudah disegarkan tick); Lepas/pengingat selesai
dibuka lagi hanya oleh pesan masuk yang lebih baru dari `coveredUntil` (baris lama tanpa kolom itu:
`anchorAt`). Rangkaian (atau bagian barunya) yang isinya hanya reaksi/penutup ("ok", "thanks", 👍;
`isNoiseMessage`, sengaja sempit; reaksi tersimpan `content` null, jadi reaksi/emoji saja **selalu**
penutup; "ok"/"siap"/"baik" dihitung jawaban hanya sesudah pertanyaan dari **agen**, bukan persona bot) dilewati;
REPLY OPEN/SCHEDULED hanya disegarkan cakupannya, FOLLOW_UP/PROMISE terbuka diserahkan ke reconcile;
baris tertutup dibuka ulang dengan `shouldReopen`/`upsertCandidate` yang sama dengan sync malam. Penutup
yang lolos saringan ditutup sync malam sebagai `JUDGED_DONE` ("dinilai selesai") bila review terbaru
menilainya `selesai` (`filteredOut.unrepliedIds` di payload). **`POST /api/outbound-jobs/process` TIDAK
punya cron di produksi** — jangan andalkan apa pun yang hanya dipanggil dari sana; menjadwalkannya (retry
ladder outbound) adalah keputusan owner tersendiri.
Pemilih tampilan (`?date=`) membuka ringkasan hari lain: kartunya memakai review hari itu,
tetapi badge "Status sekarang" dan tombol Ingatkan/Lepas memakai status `SummaryItem` yang live.
Percakapan yang sekadar aktif **tetap** dinilai LLM dan disimpan di `payload.conversations`
(keputusan owner 2026-10-18), walau halaman tidak menampilkannya.
Jenis ketiga, `PROMISE` ("Janji tim"), lahir dari `janjiTim` berstatus `terpenuhi:false` hanya untuk
percakapan yang bukan kandidat REPLY/FOLLOW_UP (keduanya selalu menang). Ia tertutup `PROMISE_KEPT` **hanya**
bila review terbaru menandai setiap janji yang dilacaknya `terpenuhi:true` — janji yang sekadar tidak disebut
lagi membiarkan item OPEN (operator bisa Lepas) — dan jadi REPLY hanya oleh pesan pelanggan yang belum dibalas.
Pesan keluar **tidak** menutupnya; janji terbuka membuka lagi DONE/REPLIED bila review itu yang terbaru
(≥ `chatReviewAt`; syarat yang sama berlaku untuk membuat PROMISE baru). Anchor = pesan janji terbuka
**terbaru** (max `createdAt`), jadi buka ulang setelah Lepas/PROMISE_KEPT tidak bergantung pada urutan
keluaran LLM. Aturan buat/buka ulang ada di satu tempat, `upsertCandidate`.

### Ringkasan chat (tab di panel kanan Inbox)
Menampilkan ringkasan LLM **terbaru** satu percakapan, tanda terjawab per pertanyaan, riwayat
per hari, dan status tindak lanjut live dari `SummaryItem` (bisa Ingatkan/Lepas dari sini).
Ringkasan terbaru disimpan di `Conversation.chatReview` / `chatReviewAt`, ditulis dua jalur:
job 00.00 (asOf = akhir hari yang diringkas) dan tombol "Perbarui sekarang"
(`POST /api/conversations/[id]/chat-review`, asOf = `now`, cooldown 30 detik).
`saveChatReview` (`src/lib/chat-review/store.ts`) menulis bersyarat dan **tidak pernah menimpa**
hasil yang lebih baru; "Buat ulang" tanggal lama di /summary tidak menurunkan tab ini.
Tiap pertanyaan membawa `terjawab` (true/false); ringkasan lama yang berupa string polos tampil
tanpa tanda. `parseReview` menurunkan item yang bentuknya melenceng, bukan menggagalkan seluruh
ringkasan. Riwayat dibaca dari payload `DailySummary`, bukan dari kolom ini.
Status review di riwayat berlabel potret netral ("Saat itu: ..."; `SnapshotStatusBadge`), bukan merah;
entri `perlu_tindakan`/`tidak_jelas` membawa `respondedAt`/`respondedMessageId`/`respondedBy` (pesan OUTBOUND
pertama sesudah akhir hari WIB itu, satu kueri di `chatReviewHistory`) -- penanda "sudah dibalas", bukan bukti semua terjawab.
Transkrip ke LLM bernomor `#N` (`buildNumberedTranscript`); model menunjuk pesan sumber lewat
`pesan`, dan `parseReview` menyimpannya sebagai `messageId` (nomor mentah tidak pernah disimpan,
nomor tidak valid dibuang). Butir pertanyaan/poin ber-`messageId` di tab ini dan di /summary bisa
diklik ke `/inbox?conversation=…&message=…`; string lama tampil sebagai teks biasa.
Review juga memuat `janjiTim` (`{ teks, terpenuhi, messageId? }`, opsional, default `[]`), tampil ✅/⏳
lewat `CheckList` yang sama dengan pertanyaan; "Perbarui sekarang" memanggil `applyReviewToItem` sesudah menyimpan
(menutup, menyegarkan, atau membuat/membuka lagi PROMISE; REPLY/FOLLOW_UP yang terbuka tidak disentuh), lalu
mengirim `summary-items:changed`.
Dipangkas setelah **30 hari** sejak `chatReviewAt` (keputusan owner 2026-10-19), sama dengan
DailySummary dan SummaryItem — isinya memuat poin penting chat pelanggan.

### Aksi booking (chat → booking)
<!-- aksi-booking:mulai -->
Pesan pelanggan yang menyebut data booking (titik/jam/detail jemput-antar, kaos, tanggal, pax, hotel,
catatan) menjadi kartu di panel kanan Inbox. Tabel: `BookingFact` (fakta dari chat; nilai lama diberi
`supersededAt`, tidak ditimpa), `BookingAction` (satu usulan/tugas), `BookingActionEvent` (riwayat
append-only tanpa FK: siapa, kapan, nilai lama/baru), `PushSubscription`. Setelan di `Settings`:
`bookingLightApproval`, `bookingBaliApproval`, `dataRequestApproval` (`APPROVE` | `ALWAYS`), **ketiganya default
`ALWAYS`** (keputusan owner 2026-10-20: yang bisa diupdate langsung tidak perlu approval admin; admin dikabari sesudahnya).

- **Ekstraksi per pesan** (`src/lib/booking-actions/schedule.ts`, `scheduleBookingExtraction`): debounce 8 s per
  percakapan, tidak di-await di jalur webhook, seluruhnya try/catch, **run pipeline sendiri**
  (`openPipelineRun`), tidak memakai tracer bot. Gerbang: nomor Indonesia dilewati kecuali percakapan uji,
  harus punya `bookingData`, trip yang sudah lewat dilewati, penutup/reaksi tidak memicu; `botEnabled` sengaja
  tidak diperiksa. Nomor flight/kereta untuk titik bandara/stasiun adalah `*_detail` (legacy menyimpannya di
  `*_point_value`); butir `*_arrival` di sisi bandara/stasiun dipetakan ke `*_detail` oleh `remapArrivalToDetail` (owner
  2026-10-21: kartu `drop_arrival` tanpa jalur tulis menggantung). Ke LLM hanya `pickup`, `dropoff`, `date`, `total_pax`, `hotels`, `tshirtSize` —
  **tidak pernah** `financial`, `expense`, `paymentHistory`, `guestDetails`. Hanya pesan INBOUND yang boleh jadi
  sumber usulan/fakta. Ekstraksi membaca ulang 20 pesan terakhir, jadi `applyExtraction` meringkas keluaran per
  field ke pesan terbaru dan memakai batas air: usulan dari pesan yang tidak lebih baru dari pesan sumber
  CHANGE/TASK non-OPEN field itu dilewati (nilai lama tidak hidup lagi). Pengecualian pendamping titik: fakta
  detail/kedatangan dari pesan YANG SAMA dengan perubahan titik tetap masuk dan tidak diusangkan (batas 1 ms sebelum pesan
  itu; `supersedeOlderFacts` hanya yang lebih tua) -- "drop di bandara, flight ABC123" (owner 2026-10-21). CHANGE/TASK yang dibuat atau dieksekusi
  menandai fakta lama field itu usang (`supersedeOlderFacts`).
- **Gerbang uji & rollout** (`src/lib/booking-actions/rollout.ts`, Ruling R25): percakapan uji = `isTest` atau
  nomor di env `BOOKING_ACTIONS_TEST_PHONES` (dipisah koma); keduanya lolos gerbang nomor Indonesia di semua
  gerbang (`blockedByIndonesianGate`), dan nomor uji tetap dicari bookingnya (sandbox tidak). Env
  `BOOKING_ACTIONS_ROLLOUT` = `test` (bawaan) | `all`: selama `test`, ekstraksi, terapkan-otomatis, dan
  pembuatan/pengiriman permintaan data hanya untuk percakapan uji (`bookingAutomationAllowed`). Owner membuka
  `all` sesudah uji whitelist.
- **Kelompok** (`changeGroup` di `fields.ts`): `AI` (titik/jam/detail di Surabaya, kaos, catatan), `BALI`
  (booking dengan transport Bali: AI mengubah **dan** vendor dikabari), `HEAVY` (pindah Surabaya ↔ Bali,
  tanggal, pax, hotel: hanya tugas untuk admin). **Jenis kartu**: `CHANGE` (usulan ubah/isi), `MISMATCH`
  (chat ≠ backoffice, peringatan), `TASK` (tugas ops), `DATA_REQUEST` (draf permintaan data ke tamu).
  Jam `07:00` (R2): backoffice membentuk jam kosong menjadi 07:00, jadi `bookingTimeKnown` menganggap `null`,
  `''`, `07:00` tidak diketahui — itu hanya menahan **peringatan** MISMATCH jam. `changeAlreadyApplied`
  membandingkan nilai mentah (`07:00` = `07:00`, supaya kartu jam 07:00 tertutup), dan permintaan data (R23,
  di bawah) tidak menanyakan jam `07:00` — tiga aturan untuk satu nilai yang sama. Ukuran kaos dibandingkan
  dalam bentuk kanonik `canonicalTshirtSizes` (urutan ukuran backoffice), bukan string. Token menempel
  "2xl"/"3xl" tanpa jumlah eksplisit **ambigu** (2 × XL atau satu 2XL?): `parseTshirtSizes` menolaknya (null); prompt
  ekstraksi wajib menulis bentuk kanonik "XL x 2, M x 1" dengan `total_pax` sebagai petunjuk, atau tidak menulis butir
  itu. Permintaan kaos yang tetap tak terbaca TIDAK dibuang diam-diam: `Extraction.unclear` → `applyExtraction` membuat
  TASK HEAVY "Ukuran kaos tidak jelas — cek chat" (tanpa terapkan-otomatis; dapat tanda terima dan push admin).
  "2XL x 1" (jumlah eksplisit) = XXL × 1; tidak ambigu: "1xl" = XL × 1, "2xxl"/"3xxl" = n × XXL, "2m". Ambigu hanya
  "2xl"/"3xl"/"2xs" tanpa jumlah eksplisit. Koreksi manual yang tak terbaca ditolak 400 dengan `TSHIRT_AMBIGUOUS_ERROR`
  ("tulis seperti: XL x 2, M x 1").
- **Eksekusi** (`execute.ts`, `executeBookingAction`): menulis lewat endpoint `my-booking` legacy
  (`src/lib/booking/backoffice-client.ts`, env `LEGACY_BASE_URL`). **Sebelum menulis, Setujui dan Batalkan
  selalu mencari booking segar ke API** (`lookupBookingResult`), karena form update-pickup/update-drop mengirim
  ulang titik + detail + jam dan `bookingData` tersimpan bisa basi s.d. 24 jam: lookup gagal = 503 tanpa menulis,
  booking lain = 409, nilai sudah ada di backoffice = kartu ditutup `MATCHED_IN_BACKOFFICE` tanpa menulis; form
  dirakit dari data segar itu. Klaim `OPEN → EXECUTING` memakai `claimedAt`;
  klaim basi (> `STALE_CLAIM_MS`, 2 menit) dilepas `releaseStaleExecuting`. Bila `bookingData.booking_id`
  sudah berganti sejak kartu dibuat, eksekusi ditolak 409. Kartu titik ↔ detail pada sisi yang sama ditulis
  satu patch (`companionFields`). `revertBookingAction` mengembalikan nilai lama selama booking belum berubah
  lagi. `autoApplyIfAllowed` (mode `ALWAYS`, actor `SYSTEM`) memakai `executeBookingAction` yang sama dan
  bisa dibatalkan. Kartu yang ditutup orang tidak dibuat ulang untuk field+nilai yang sama; fakta terbaru
  menggantikan yang lama.
- **Vendor Bali** (`bali-vendor.ts`, `notifyBaliVendor`): sesudah CHANGE `BALI` tertulis, template
  `internal_bali_transport_update` masuk antrean; tanpa data pribadi tamu. Hanya dikirim bila booking segar
  pasca-tulis memuat nilai yang ditulis; jam tak diketahui ditulis "jam belum ada". Gagal = event
  `VENDOR_NOTICE_FAILED` + push, vendor dikabari manual.
- **Vendor kaos** (`tshirt-vendor.ts`, `notifyTshirtVendor`): jalur legacy `updateTshirt` yang kita panggil hanya
  menyimpan + `EcosystemSync::notify`, tidak mengabari vendor (yang mengabari hanya new-backoffice
  `notifyTshirtVendor`). Maka eksekusi yang menulis `tshirt_sizes` mengirim template `internal_tshirt_update`
  (kode, tanggal, pax, ukuran; **tanpa nama tamu**) ke nomor default new-backoffice (`WA_TSHIRT_VENDOR_NUMBER`), env
  `TSHIRT_VENDOR_PHONE` menimpanya; kunci `tshirt_update:<actionId>`, Batalkan `tshirt_revert:<actionId>`. Aturan
  booking-segar dan gagal = `VENDOR_NOTICE_FAILED` + push sama dengan vendor Bali.
- **Tujuan vendor saat uji** (`vendor-destination.ts`, `vendorDestination`, berlaku untuk Bali dan kaos): selama
  rollout `test`, kabar dari percakapan uji (`isBookingTestConversation`) dikirim ke nomor PERTAMA
  `BOOKING_ACTIONS_TEST_PHONES` (`firstBookingTestPhone`), tidak pernah ke vendor sungguhan; tanpa nomor uji = tidak
  dikirim (event `TEST_PHONE_MISSING`, tanpa push); gagal membaca percakapan = kabar gagal (event + push).
- **Satu permintaan = SATU WhatsApp** (owner 2026-10-21): bot tidak ikut menjawab pesan yang menjadi kartu --
  `flushBurst` (`inbound.ts`) menjalankan `runBookingExtractionNow` dulu (membatalkan debounce ekstraksi) dan diam bila
  run itu melahirkan kartu CHANGE/TASK. Kartu yang tertulis dijawab kabar "sudah diperbarui", yang sudah sesuai dijawab
  "sudah sesuai" (tanpa syarat tanda terima), dan hanya kartu yang masih OPEN sesudah terapkan-otomatis yang mendapat
  tanda terima. Ketiganya memakai `purpose: 'SYSTEM'` (lolos safety guard saat admin mengambil alih) dan bahasa chat tamu
  (`guestLanguage`; negara `isIndonesianGuest` hanya cadangan).
- **Tanda terima ke tamu** (`guest-ack.ts`, `notifyGuestRequestReceived`, owner 2026-10-20; urutan diubah 2026-10-21):
  `runExtraction` memanggilnya SESUDAH `autoApplyCreated`, hanya untuk kartu `state: 'OPEN'`; memicu hanya bila run itu
  melahirkan kartu `CHANGE`/`TASK` dari pesan tamu (bukan `MISMATCH`/`DATA_REQUEST`, bukan kartu yang lahir di `reevaluateBookingActions`). Kartu isian yang lahir di `evaluate()` DI DALAM `applyExtraction`
  DOES memicunya. Kartu dipilih dari `applyExtraction().cardIds` (id CHANGE+TASK yang dibuat run itu), bukan jendela waktu.
  Event `GUEST_ACK_SENT` ditulis SEBELUM kirim (klaim di bawah kunci advisory) sehingga run tumpang tindih tidak kirim
  ganda; kirim gagal tidak diulang. Bila terapkan-otomatis mendapati nilainya sudah ada (MATCHED_IN_BACKOFFICE), tamu
  dikabari "sudah sesuai" (`notifyGuestOfUpdate` `variant: 'matched'`) sebagai satu-satunya jawaban.
  Satu pesan per run: "Noted, we've received your request and are processing it now." / "Noted, permintaan Anda sudah
  kami terima dan sedang kami proses." (kode, tanpa LLM/nama; bahasa lewat `guestLanguage`). Gerbang sama dengan kabar
  ke tamu (WhatsApp bernomor, `bookingAutomationAllowed`, jendela 24 jam terbuka; tertutup = diam tanpa push) dan terkirim
  walau `botEnabled` mati. Idempotensi: event `GUEST_ACK_SENT` di setiap kartu (ekstraksi ulang tidak mengirim lagi) +
  maks. satu per percakapan per 2 menit. `botTrace.source = booking_request_ack`. Gagal = log nama galat, tanpa push.
  Kartu yang tertulis tidak mendapat tanda terima; kabar "sudah diperbarui" di bawah yang menjawabnya.
- **Kabar ke tamu** (`guest-notice.ts`, `notifyGuestOfUpdate`, owner 2026-10-20): WhatsApp lewat `sendMessage`:
  "Noted" + satu baris per field yang benar-benar ditulis + tautan portal (short link bila API memuatnya, lalu
  `client_portal_url`, lalu `customer_portal`; tidak ada = tanpa baris tautan). Tautan my-booking panjang diganti
  `jvto.me/b/<kode>` (`resolveGuestPortalLink`): kode dihitung ulang dengan rumus `BookingShortUrl` PHP
  (`src/lib/booking/short-link.ts`) dan **hanya dipakai bila** legacy `GET /bookings/short/{code}` menjawab url booking
  yang sama (`verifiedBookingShortCode`) -- kode hasil hitungan bisa milik tamu lain; gagal/404 = tautan panjang. Balasan bot
  (`orchestrator.ts`, Mode 3) memakai short link yang sama: catatan tautan portal DAN JSON booking di prompt/grounding
  membawa `jvto.me/b/<kode>` alih-alih `customer_portal`/`client_portal_url` panjang. EN bawaan, ID bila `isIndonesianGuest`.
  Setujui manual = satu kabar per eksekusi. Terapkan-otomatis: `executeBookingAction` menunda (`deferGuestNotice`) dan
  `autoApplyCreated` mengirim SATU kabar + SATU push `AUTO_APPLIED` untuk semua kartu yang tertulis dari satu
  ekstraksi (`announceApplied`), supaya satu pesan tamu tidak dijawab beberapa "Noted". Hanya kartu dari pesan INBOUND,
  hanya selama `bookingAutomationAllowed`; kunci `guest_update:<kartu pertama>`, `GUEST_NOTICE_SENT` dicatat di setiap
  kartu dan menahan ulangan. Jendela 24 jam tertutup = tidak kirim, event `GUEST_NOTICE_SKIPPED` (`WINDOW_CLOSED`) +
  push `GUEST_NOTICE_FAILED`; kirim gagal = `GUEST_NOTICE_FAILED` + push yang sama. Di kanal Unofficial "terkirim"
  berarti masuk antrean outbound (kegagalan penyedia sesudahnya dipegang retry ladder, tidak memicu push).
  **Batalkan tidak mengabari tamu**; bila tamu sudah dikabari, Batalkan mengirim push "Kabari tamu manual — perubahan
  dibatalkan" dan respons membawa `hint` yang tampil di panel.
- **Kabar otomatis bukan balasan** (`src/lib/summary-items/automated.ts`, `automatedMessageIds`/`findOurReply`): pesan
  ber-`botTrace.source` `booking_update_notice`, `booking_request_ack` atau `data_request` dikecualikan dari setiap cek "balasan kita" di
  `sync.ts` (REPLY/FOLLOW_UP/PROMISE, live dan reconcile), `classifyConversation`, `refreshChatReview` (`reasons` dari
  pesan terakhir yang bukan kabar otomatis) dan `respondedAt` di `chatReviewHistory`. Dikenali lewat SATU kueri id
  dengan filter JSON **positif** (aman NULL; filter negatif membuang balasan sungguhan), lalu dikecualikan per id --
  botTrace tidak pernah dimuat untuk ini. Transkrip LLM melabelinya "Sistem (pesan otomatis)".
- **Kartu dari `reevaluateBookingActions`** (tanpa pesan baru, mis. sesudah penyegaran booking) **tidak** diterapkan
  otomatis: push CHANGE-nya langsung terkirim dan kartu menunggu orang; hanya kartu dari ekstraksi yang lewat
  `autoApplyCreated`.
- **Push** (`src/lib/push/send.ts`, `notifyBookingAction`): Web Push untuk tujuh jenis kejadian — kartu baru
  `CHANGE`, `MISMATCH`, `TASK`, `AUTO_APPLIED` (diterapkan otomatis), `EXECUTE_FAILED` (gagal tulis / kabar vendor
  gagal), `DATA_REQUEST_FAILED` (draf permintaan data gagal terkirim), `GUEST_NOTICE_FAILED` (tamu belum dikabari
  perubahan, kabari manual); draf permintaan data yang terkirim tidak di-push. Tag notifikasi `booking-action:<id>`;
  alarm kabar tamu/vendor memakai tag sendiri (`tagSuffix`: `:guest`, `:guest-revert`, `:vendor-tshirt`,
  `:vendor-bali`, dengan judul sendiri: "Perubahan dibatalkan — kabari tamu manual", "Kabar ke vendor gagal") supaya
  tidak tergantikan `AUTO_APPLIED`. Setiap push mencatat event `PUSHED` (disembunyikan dari
  riwayat); tick menjalankan `pushUnnotifiedChanges` (`push-sweep.ts`): kartu CHANGE OPEN yang berubah 2 menit–1 jam
  lalu tanpa `PUSHED` (push hilang karena restart, atau `releaseStaleExecuting` mengembalikannya ke OPEN) di-push sekali;
  penanda yang gagal ditulis diingat di memori proses (`pushMarkFailedRecently`) supaya tidak di-push tiap tick. Push `CHANGE` dari `applyExtraction` **ditahan** (`changeEvents`) dan diserahkan ke `autoApplyCreated`
  (`auto-apply.ts`): kartu yang diterapkan otomatis hanya mengirim `AUTO_APPLIED` sesudah berhasil; kartu yang
  dilewati dan masih `OPEN` (setelan `APPROVE`, titik tanpa detail, lookup 409/503, rollout uji) mengirim push
  `CHANGE` saat itu; gagal = `EXECUTE_FAILED`. `MISMATCH`/`TASK` dan `CHANGE` dari `reevaluateBookingActions`
  tetap di-push saat dibuat. Env
  `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`. Setiap permintaan perubahan berlabel "belum
  dipenuhi" sampai ditutup; tidak ada kedaluwarsa.
- **Panel kanan**: `GET /api/conversations/[id]/chat-review` memuat `pinned` dan `changeHistory`. Tab ini
  ikut terbaru untuk **semua** percakapan, termasuk lead tanpa booking (owner 2026-10-20): `noteInboundForChatReview`
  (`auto-refresh.ts`) dipanggil dari jalur masuk pesan teks pelanggan (WhatsApp `inbound.ts`, Messenger/Instagram
  `inbound-messenger.ts` -- hanya teks sungguhan, bukan placeholder lampiran --, pesan uji) dan **pesan keluar AGEN**
  (`sendMessage` → `noteOutboundForChatReview`; bot dan sumber otomatis tidak), supaya janji tim kepada lead tersemat.
  Jeda: ≥ `CHAT_REVIEW_DEBOUNCE_MS` (30 dtk, pembuka burst masuk satu review) dan ≥ `CHAT_REVIEW_MIN_GAP_MS` (5 menit) sejak
  `chatReviewAt` ATAU percobaan terakhir (gagal pun, jadi LLM mati tidak dicoba tiap pesan). Pesan yang tiba SELAGI review
  berjalan menandai `dirty`: sesudah selesai satu run lagi dijadwalkan. Tombol "Perbarui sekarang"
  (`noteManualChatReviewRefresh`) menunda run otomatis berikutnya 5 menit. Membuka chat (`GET /api/conversations/[id]`
  dan `GET .../chat-review`) memanggil `noteChatOpenedForChatReview`: ada pesan sesudah `chatReviewAt` (atau belum pernah
  diringkas) = ringkasan baru dijadwalkan dengan jeda 2 dtk (`CHAT_REVIEW_OPEN_DEBOUNCE_MS`), tetap tunduk jeda 5 menit dan
  gerbang yang sama (owner 2026-10-22). Tidak ditunggu, tidak pernah melempar. Tidak
  bergantung pada booking maupun rollout aksi booking (hanya menulis catatan internal). Nomor Indonesia dilewati hanya
  bila `Settings.skipBotForIndonesianNumbers` menyala (aturan daily summary); `isTest`/nomor uji selalu lolos;
  `isNoiseMessage` tidak memicu; email dilewati. **Mematikan `skipBotForIndonesianNumbers` mengirim setiap chat Indonesia
  ke LLM cloud untuk pin point.** `runExtraction` **tidak** memanggilnya (hindari jadwal ganda).
- **Permintaan data** (`data-requests.ts`, `createDataRequestDrafts`): H-7 sampai H-1 (H-0 = trip mulai, draf
  ditutup), jam kirim 08:00–20:00 WIB (`inDataRequestHours`), satu draf per booking per hari WIB (unik
  `[bookingId, type, forDay]`), hanya butir yang kurang (`findDataGaps`); jam **tidak** ditanyakan bila nilainya
  `07:00`. Kirim otomatis dibatasi `MAX_AUTO_LOOKUPS_PER_TICK` dan `AUTO_SEND_BUDGET_MS` karena tiap percobaan
  memanggil API booking.
- **Tick 5 menit** (`POST /api/summary-items/tick`) kini juga menjalankan `refreshBookingDataForOpenActions`
  (percakapan berkartu CHANGE/TASK/MISMATCH OPEN yang datanya > 30 menit, maks. 10, berbagi anggaran 60 s
  dengan `refreshStaleBookingData`), `releaseStaleExecuting` (sesudah penyegaran booking) dan
  `createDataRequestDrafts` (sesudah `reconcileSummaryItems`).
<!-- aksi-booking:selesai -->

### Simulator & test
`simulator.ts`, Test Lab, dan `npm run eval` (13 golden case).

**Mode uji tanpa WA** (`Conversation.dryRun`, owner 2026-10-21): percakapan SUNGGUHAN milik nomor whitelist
(`BOOKING_ACTIONS_TEST_PHONES`; `canUseDryRun` di `rollout.ts`) bisa dinyalakan dari header thread
(`POST /api/conversations/[id]/dry-run`, 403 untuk nomor lain). Selama menyala, kotak pesan memilih **Tamu** (pesan
masuk buatan lewat `test-message`, memicu bot + aksi booking seperti webhook) atau **JVTO** (`/api/send` biasa). Tidak ada
fungsi lain yang berubah: booking tetap dicari dan ditulis sungguhan, push PWA tetap terkirim; hanya WhatsApp yang
disimulasikan -- `sendMessage` mencatat pesan tanpa dispatch/antrean (sama dengan sandbox `isTest`), dan kabar vendor
kaos/Bali dicatat sebagai event `VENDOR_NOTICE_SIMULATED` (`vendorDestination` -> `{ simulate: true }`, apa pun rollout-nya).

### Deployment gate
`deployment-gate.ts` — gerbang persetujuan katalog ber-HMAC.
**Ini berbeda total dari fitur "release" yang dihapus**, hanya kebetulan sekata. Jangan
disentuh, jangan disamakan, jangan dihapus.

---

## 5. Larangan Mutlak (Zero Tolerance)

- **Simulator** (`src/lib/bot-control/simulator.ts`) **DILARANG** memanggil `sendMessage`
  atau membuat `OutboundJob`. Dry-run saja. Wajib ada test yang membuktikannya.
- **Jangan pernah menampilkan token/API key** di UI, API response, audit log, atau dokumen
  ekspor apa pun.
- **Jangan overwrite `KnowledgeSource` bertipe `MANUAL`.** Penjaga `type` di
  `knowledge-workflow.ts` ada supaya penulis berbasis file yang baru **gagal keras**
  alih-alih diam-diam menimpa tulisan operator. Jangan longgarkan.
- **Dilarang `any`.** Pakai `unknown` atau tipe yang sesuai.
- **Dilarang menjalankan `npx prisma migrate dev` terhadap database produksi.** Perintah itu
  bisa **me-reset database** saat mendeteksi drift, dan `DATABASE_URL` di repo ini menunjuk
  VPS produksi.
- **Jangan uji ke nomor pelanggan sungguhan.** Test bot/messaging hanya ke nomor whitelist.

## 6. Aturan API

Setiap mutation:
1. Auth (`getSession`).
2. Otorisasi lewat `hasAdminPowers()` — **tidak ada matriks izin**; setiap tindakan
   istimewa bermuara ke satu pertanyaan itu.
3. Validasi body dengan Zod (termasuk batas min/max dari `safety-bounds.ts`).
4. Audit log lewat `writeBotAuditLog` **kalau** perubahannya mengubah apa yang bot lakukan.
5. Transaksi Prisma kalau ada lebih dari satu tulisan yang harus konsisten. Saat dipanggil
   dengan client transaksi, tulisan audit **melempar**; saat standalone, ia ditelan.

Pengecualian tunggal untuk langkah 2: perbaikan knowledge dari Inbox
(`POST /api/inbox/decisions/[id]/fix`) terbuka untuk semua yang login karena setiap simpan
berversi, dapat dikembalikan, dan tercatat di audit log — route knowledge lainnya tetap lewat
`hasAdminPowers()`.

Pengecualian kedua: route aksi booking — `/api/booking-actions/[id]` (semua op), `/api/booking-actions`,
`/api/conversations/[id]/booking-actions`, `/api/push/subscribe` — terbuka untuk semua akun yang login
(keputusan owner 2026-10-19). Alasannya: setiap aksi tercatat di `BookingActionEvent` dengan nilai lama dan
bisa dikembalikan (`revertBookingAction`). Kolom `Settings` untuk fitur ini tetap lewat `hasAdminPowers()`
di `PATCH /api/settings`.

Response error selalu `{ error: string }` dengan status HTTP yang sesuai. `try-catch` di
setiap handler; jangan bocorkan pesan error mentah atau secret.

## 7. Migrasi Prisma

- **Development lokal:** `npx prisma migrate dev`.
- **Production (VPS):** buat migrasi offline dengan
  `npx prisma migrate diff --from-schema <schema lama> --to-schema prisma/schema.prisma --script`,
  simpan ke `prisma/migrations/<timestamp>_<nama>/migration.sql`, lalu terapkan dengan
  `npx prisma migrate deploy`.
- **Periksa SQL-nya sebelum menerapkan.** `DROP`, `TRUNCATE`, dan `ALTER TABLE` non-aditif
  harus didiskusikan lebih dulu.
- Deploy ke VPS: `git checkout` dari `origin/main` di VPS, dan **export PATH nvm Node 22**
  atau semua perintah Prisma 7 mati di Node 18 bawaan.

### Migrasi right-sizing (selesai di produksi 2026-09-08)

Kode dan database produksi sudah sinkron sejak commit `90676c2`. Prosedur yang dipakai —
termasuk dua jebakan yang nyaris merugikan — ada di `docs/right-size-migration/RUNBOOK.md`.
Urutan yang terbukti aman dan sebaiknya diulang untuk migrasi destruktif berikutnya:
cadangkan → SELECT verifikasi → migrasi aditif → deploy kode → verifikasi sehat →
migrasi destruktif.

## 8. Checklist Sebelum Commit per PR

1. `npm test`
2. `npx tsc --noEmit`
3. `npx eslint .` (0 error, warning boleh)
4. Kalau ada perubahan skema Prisma: ikuti section 7.

## 9. Verifikasi Sebelum Menyatakan

**Setiap pernyataan tentang perilaku sistem harus berasal dari _call site_-nya — bukan dari
spec, diagram, PDF, atau pernyataan sebelumnya, termasuk pernyataan agen itu sendiri di
percakapan yang sama.**

Empat aturan turunan, semuanya lahir dari kesalahan nyata:

- **Satu file bukan keseluruhan.** `general-modules.json` adalah satu dari **14** file katalog
  yang dibaca bot; `TOPIC_MODULES` adalah satu dari beberapa resolver yang mengisi prompt.
  Menyimpulkan cakupan dari satu potongan adalah cara tercepat menghasilkan pernyataan yang
  salah dengan percaya diri.
- **Angka dihitung ulang dari kode, tidak pernah disalin.** Angka yang disalin dari pesan
  sebelumnya membawa kesalahannya ikut, dan pengulangan membuatnya terlihat mapan.
- **Sebelum menyatakan sesuatu tidak terpakai, cari seluruh pemakainya**, bukan pemakai di
  modul yang kebetulan sedang dibaca.
- **Dokumen keluaran diverifikasi mekanis sebelum diserahkan**, tidak dibaca ulang manual.
  Pembacaan ulang manual gagal persis pada hal yang sudah diyakini benar.

### Bukti historisnya (jangan sampai hilang)

Audit alur grounding **2026-09-10** menghasilkan lima pernyataan salah berturut-turut, semuanya
dari sebab yang sama — menulis tentang jalur yang belum pernah ditelusuri utuh:

| Dinyatakan | Kenyataannya |
| --- | --- |
| `route_endpoint` tidak punya fakta karena `TOPIC_MODULES`-nya kosong | dijawab dari `finishCities`, dikomposisi di `orchestrator.ts` |
| Katalog = 77 modul | 77 hanya isi `general-modules.json`; bot membaca 14 file |
| Enam modul `staging` yatim | terpakai penuh lewat `catalog.ts` → `stagingNotes` |
| `GENERAL_FAQ_FALLBACK` 887 token "dikoreksi" jadi 882 | 887 benar — 882 hasil menjumlahkan per blok dan kehilangan pemisah antar blok |
| — | `SHARED_PERSONA_INSTRUCTIONS` (402 token, terkirim setiap giliran) tidak pernah disebut sama sekali |

**Tidak satu pun tertangkap oleh pemeriksaan mandiri sebelum dokumen diserahkan.** Tiga muncul di
audit yang diminta operator, satu dari pertanyaan operator, dan satu dari pemeriksa mekanis —
yang baru dibuat setelah operator menuntut polanya berhenti. Satu pembacaan `orchestrator.ts` di
titik komposisi prompt membatalkan tiga pernyataan sekaligus.

Pelajaran yang mengikat: **agen bukan pemeriksa yang andal atas pekerjaannya sendiri kalau
pemeriksaannya berupa membaca ulang.** Yang menangkap kesalahan di atas adalah pengukuran ulang
dan perbandingan otomatis, bukan ketelitian.

### Urutan wajib sebelum menyerahkan dokumen, laporan, atau audit

1. Telusuri jalur eksekusinya **sekali, utuh**, dari titik masuk sampai titik pakai.
2. Hitung ulang setiap angka dari sumbernya.
3. Pastikan setiap identifier yang dikutip benar-benar ada di repo.
4. Jalankan pemeriksa mekanis yang **bisa gagal** (keluar dengan kode ≠ 0). Dokumen tidak
   diserahkan sebelum pemeriksa hijau.

Pemeriksa itu bagian dari keluarannya, bukan tambahan opsional: kalau sebuah dokumen mengklaim
angka dan nama simbol, harus ada cara menjalankan ulang klaim itu tanpa membacanya lagi.

---

## 10. Referensi

- **`CLAUDE.md` (dokumen ini) adalah sumber kebenaran.**
- `.claude/docs/bot-control-spec.md` dan `.claude/docs/bot-control-manage-second-spec.md`
  (serta salinannya `docs/wa-inbox-chatbot-control-center-manage-second-guidebook.md`)
  adalah **dokumen desain historis yang sebagian besar sudah dibatalkan**. Baca catatan
  status di bagian atas masing-masing file sebelum memakainya. Kalau spec bertentangan
  dengan kode atau dengan dokumen ini, **kode dan dokumen ini yang berlaku.**
- Alasan bentuk tiap modul ditulis sebagai komentar di kepala file yang bersangkutan
  (`audit.ts`, `knowledge-workflow.ts`, `safety-bounds.ts`, `stuck.ts`, `permissions.ts`,
  `Settings` di `prisma/schema.prisma`). Baca itu sebelum mengubahnya.

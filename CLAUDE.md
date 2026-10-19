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

### Simulator & test
`simulator.ts`, Test Lab, dan `npm run eval` (13 golden case).

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

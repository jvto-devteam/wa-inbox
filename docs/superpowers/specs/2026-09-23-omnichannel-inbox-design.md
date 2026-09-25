# Omnichannel Inbox — Desain

**Tanggal:** 2026-09-23
**Status:** desain, menunggu review operator. Belum ada kode.
**Pemeriksa mekanis:** `node docs/superpowers/specs/check-omnichannel-design.mjs` (wajib hijau)

---

## 1. Tujuan

Pesan masuk dari **WhatsApp, Instagram DM, Facebook Messenger, dan Email** semuanya
mendarat di wa-inbox, terbaca di satu tempat, dan bisa dibalas dari sana.

Autoreply bot punya **sakelar sendiri per channel**: bot bisa hidup di WA dan Email tapi
mati di IG dan FB, atau kombinasi mana pun.

### Di luar cakupan

- **Komentar publik IG/FB** — ditunda atas keputusan operator 2026-09-23. Wadahnya berbeda
  (menggantung di postingan, bukan di orang) dan risikonya berbeda (balasan salah terlihat
  semua orang). Kalau nanti dikerjakan, ia spec tersendiri.
- **Multi-tenancy.** Tidak sekarang, tidak nanti — lihat CLAUDE.md §1.

---

## 2. Keputusan yang sudah dikunci

Semua diputuskan operator dalam sesi brainstorming 2026-09-23.

| Keputusan | Pilihan | Alasan |
| --- | --- | --- |
| Satu baris sidebar = apa | **Satu benang** (bukan satu orang) | Tetap benar meski identitas lintas-platform belum pernah digabungkan operator. Bisa diubah ke tampilan per-orang nanti **tanpa migrasi** — ini murni soal render. |
| Penyaring email | **Melabeli, tidak menggerbang** | Semua email tetap masuk — tidak ada yang dibuang. Klasifikasi otomatis memberi label `LEAD` / `OPERASIONAL` / `BISING` yang hanya mengatur urutan, filter, dan badge di tab Email. |
| Model pelabel | **`qwen2.5:latest` (lokal)** | Terverifikasi terpasang di daemon VPS. Model produksi `gemma4:31b-cloud` meneruskan teks ke ollama.com (CLAUDE.md §2), dan kotak masuk email memuat invoice serta surat pribadi — jadi pelabelan tidak boleh memakainya. |
| Bot di email | **Draf manual saja** | Tombol ditekan operator. Tidak ada balasan email otomatis. Klasifikasi otomatis di atas **hanya melabeli**, tidak pernah menyusun atau mengirim jawaban. |
| Pemisahan visual | **Tab per channel**, default WhatsApp | Hari pertama setelah deploy, tim melihat persis apa yang mereka lihat sekarang. |
| Sakelar bot | **Empat, terpisah** — WA / IG / FB / Email | Permintaan operator langsung. |
| Protokol email | **Gmail API** | Terverifikasi: `dig MX javavolcano-touroperator.com` → `1 SMTP.GOOGLE.com`. Kedua kotak surat ada di Google, jadi satu pola integrasi, bukan dua. |

---

## 3. Yang sudah ada dan dipakai ulang

Bagian ini ditulis lebih dulu karena ia memotong ruang lingkup secara drastis. Tiga hal
yang tampak seperti fitur baru ternyata sudah terbangun:

### 3.1 Alur draf manual — sudah lengkap, sudah manual-only

`src/lib/inbox/message-draft.ts` sudah menyediakan persis alur yang diminta operator untuk
email: buat draf dari knowledge → sunting → kirim. Komentar di kepala file menyatakannya
tegas: *"agen bisa membuat, membuat ulang, mengedit, dan mengirimnya sebagai balasan yang
mengutip pesan sumber — **tidak pernah otomatis**."*

Fungsi yang sudah ada: `generateDraft`, `editDraft`, `reviseDraftWithPrompt` (menyunting draf
dengan instruksi bahasa alami), `sendDraft`, `draftsForConversation`. Tabel `MessageDraft`
sudah merekam `generatedText`, `text` hasil suntingan, `decision`, `pendingKnowledgeGaps`,
dan jejak siapa membuat/menyunting/mengirim. UI-nya `src/components/inbox/MessageDraftCard.tsx`,
tombolnya di `src/components/inbox/MessageBubble.tsx`.

**Konsekuensi:** kebutuhan "generate draft untuk email" bukan fitur baru. Yang kurang hanya
jalur kirimnya — `sendDraft` bermuara ke `sendMessage` yang saat ini WhatsApp-saja.

### 3.2 Idempotensi pesan — kolom sudah ada

`Message.externalId String? @unique` sudah jadi kunci anti-duplikat. `messageId` Gmail dan
`mid` Instagram/Messenger masuk ke kolom yang sama. Tidak perlu kolom baru.

### 3.3 Verifikasi webhook Meta — sudah generik

`verifyMetaSignature` di `src/lib/meta/webhook-verify.ts` memakai `timingSafeEqual` atas raw
body dengan `META_APP_SECRET`. Meta memakai app secret yang sama untuk WhatsApp, Instagram,
dan Page — jadi lapisan ini **tidak perlu diubah sama sekali**.

### 3.4 Pola kredensial per-akun — sudah ada contohnya

`WaNumber` menyimpan kredensial per nomor WhatsApp. `MailAccount` meniru bentuk itu untuk
kotak surat. Bukan pola baru.

---

## 4. Model data

### 4.1 Masalahnya sekarang

Tiga kunci mengunci asumsi "satu manusia = satu nomor = satu benang":

- `Contact.phone String @unique` — identitas kontak **adalah** nomor telepon.
- `Conversation.contactId String @unique` — satu kontak hanya boleh punya satu percakapan.
- `MessageChannel { OFFICIAL, UNOFFICIAL }` — ini **bukan** platform, melainkan dua jalur
  WhatsApp (Meta Cloud API vs wa-coexist).

Yang ketiga penting dipahami supaya tidak salah ubah: **`MessageChannel` tidak disentuh sama
sekali.** `Platform` adalah dimensi baru di sebelahnya. Kalau IG dijadikan nilai ketiga di
enum itu, dispatch di `src/lib/send.ts` dan `src/lib/outbound/worker.ts` akan salah rute.

### 4.2 Bentuk baru

```prisma
enum Platform {
  WHATSAPP
  INSTAGRAM
  FACEBOOK
  EMAIL
}

/// Alamat satu orang di satu platform. Contact = manusianya; ChannelIdentity = alamatnya.
model ChannelIdentity {
  id          String   @id @default(cuid())
  platform    Platform
  /// WA: 6281… · IG: IGSID · FB: PSID · EMAIL: alamat@domain
  externalId  String
  contactId   String
  contact     Contact  @relation(fields: [contactId], references: [id])
  displayName String?
  createdAt   DateTime @default(now())

  conversations Conversation[]

  @@unique([platform, externalId])
  @@index([contactId])
}

/// Kotak surat MILIK JVTO (bukan pelanggan). Meniru bentuk WaNumber.
model MailAccount {
  id             String    @id @default(cuid())
  emailAddress   String    @unique
  /// Token OAuth. TIDAK PERNAH keluar ke UI, API response, atau audit log (CLAUDE.md §5).
  refreshToken   String
  /// Kursor Gmail history.list. Null = belum pernah tersinkron.
  historyId      String?
  /// watch() Gmail mati tiap 7 hari. Null / lewat = harus diperpanjang.
  watchExpiresAt DateTime?
  createdAt      DateTime  @default(now())

  conversations Conversation[]
}
```

Perubahan pada model yang sudah ada:

```prisma
model Contact {
  // phone @unique DILEPAS (fase 3, destruktif). Nomor pindah ke ChannelIdentity.externalId.
  identities ChannelIdentity[]
}

model Conversation {
  // contactId @unique DILEPAS.
  channelIdentityId String
  channelIdentity   ChannelIdentity @relation(fields: [channelIdentityId], references: [id])

  /// Hanya untuk EMAIL: kotak surat mana yang disurati. Menentukan alamat pengirim balasan.
  mailAccountId     String?
  mailAccount       MailAccount?    @relation(fields: [mailAccountId], references: [id])

  /// Hanya untuk EMAIL: subjek benang, dan threadId Gmail.
  subject           String?
  externalThreadId  String?

  @@unique([mailAccountId, externalThreadId])
  @@index([channelIdentityId])
}
```

### 4.3 Satu aturan yang tidak boleh ditebak

**Balasan keluar dari alamat yang disurati.** Pelanggan menulis ke `hello@` → jawabannya dari
`hello@`. Karena itu `Conversation.mailAccountId` disimpan eksplisit, bukan disimpulkan.
Orang yang sama menyurati dua alamat JVTO = dua benang. Itu benar, bukan bug.

### 4.4 Penggabungan identitas

Menggabungkan "orang IG ini = orang WA ini" adalah **tindakan manual operator** di level
`Contact`. Tidak ada tebakan otomatis: nama sama bukan bukti. Benangnya tetap terpisah;
yang menyatu hanya kartu kontaknya.

---

## 5. Gerbang bot: tetap satu, bukan dua

**Ini bagian paling mudah dibangun salah.**

Rantai yang sekarang, dari call site:

- Saat pesan masuk, satu-satunya yang dibaca adalah `conversation.botEnabled`
  (`src/lib/inbound.ts`, cabang `conversation.botEnabled && botCanAnswer`).
- `Settings.botAutoReplyAll` **bukan gerbang runtime.** Ia bekerja dengan `updateMany` ke
  setiap percakapan (`src/app/api/bot/mode/route.ts`), lalu menyingkir.
- `botEnabled` dibaca **ulang** dari database saat burst di-flush, supaya agen yang menekan
  "Ambil Alih dari Bot" di tengah jeda debounce tidak tertimpa nilai basi.

Alasannya ditulis di kepala `defaultBotEnabled` (`src/lib/inbound.ts`): dulu ada dua penulis
untuk keputusan yang sama, dan "salah satu menyala berarti menang" membuat separuh kontrolnya
jadi no-op.

### Maka sakelar per-channel adalah PENULIS MASSAL, bukan gerbang kedua

```
Settings.botEnabledWhatsapp / Instagram / Facebook / Email   (Boolean, default: WA true, sisanya false)
        │
        ├─ saat di-toggle  → updateMany { where: platform, data: { botEnabled: <nilai> } }
        └─ saat percakapan BARU lahir → defaultBotEnabled(platform) membacanya
                                              │
                                              ▼
                              Conversation.botEnabled   ← SATU-SATUNYA gerbang runtime
```

`defaultBotEnabled` berubah tanda tangan: menerima `platform` (dan nomor, yang kini opsional
karena hanya WhatsApp punya). Filter `skipBotForIndonesianNumbers` **hanya berlaku untuk
WHATSAPP** — IGSID dan PSID adalah angka panjang yang tidak akan cocok dengan regex `/^62\d+$/`
di `src/lib/phone.ts`, jadi tanpa penjagaan eksplisit filter itu akan tampak menyala tapi
diam-diam tidak melakukan apa pun di channel lain.

### Konsekuensi yang diterima sadar

Mematikan lalu menyalakan IG **akan** menghapus override per-chat di IG. Itu bukan perilaku
baru — persis yang dilakukan sakelar global sekarang, dan `src/app/api/bot/mode/route.ts`
menyebutnya preseden *"bulk write always wins"*.

---

## 6. Alur masuk

### 6.1 WhatsApp — tidak berubah

### 6.2 Instagram DM & Facebook Messenger

Endpoint webhook **sama** (`src/app/api/webhooks/meta/route.ts`), verifikasi signature sama.
Yang ditambah: percabangan atas `payload.object`.

| `payload.object` | Bentuk payload | Platform |
| --- | --- | --- |
| `whatsapp_business_account` | `entry[].changes[].value.messages[]` | WHATSAPP |
| `instagram` | `entry[].messaging[]` | INSTAGRAM |
| `page` | `entry[].messaging[]` | FACEBOOK |

IG dan FB berbagi bentuk payload yang identik, jadi keduanya satu adapter dengan `platform`
sebagai parameter — bukan dua.

**SELESAI pada fase Facebook (2026-09-25).** Ketika ditulis, bagian ini berbunyi "`inbound.ts`
hanya mengenali bentuk pertama, jadi pesan IG/FB masuk, lolos verifikasi, lalu dibuang diam-diam
sambil membalas 200". Itu tidak lagi benar untuk **kedua** platform: `isMessengerPayload`
(`src/lib/meta/messenger-types.ts`) menerima `page` DAN `instagram`, dan `src/lib/inbound.ts`
memetakan `payload.object === 'instagram'` ke `INSTAGRAM` sebelum memanggil adapter yang sama.

Konsekuensinya untuk fase Instagram: **jalur masuknya tidak perlu dibangun lagi.** Yang tersisa
adalah pengiriman keluar (`src/lib/send.ts` masih bertipe `'WHATSAPP' | 'FACEBOOK'`), pencarian
nama yang masih terpaku Facebook (`src/lib/meta/messenger-profile.ts`), dan izin Meta.

### 6.3 Email

Dua lapis, dan lapis kedua bukan optimisasi:

1. **Push** — Gmail `users.watch()` → Google Cloud Pub/Sub → POST ke endpoint wa-inbox.
   Payload-nya **bel pintu, bukan paket**: isinya hanya `historyId`. Isi pesannya diambil
   menyusul lewat `history.list` → `messages.get`.
2. **Tarik berkala (15 menit)** lewat crontab VPS yang sudah ada — jaring pengaman, **dan**
   yang memperpanjang `watch()`.

Lapis kedua wajib karena `watch()` kedaluwarsa tiap 7 hari, dan kalau perpanjangannya gagal
email berhenti masuk **tanpa error apa pun**. Repo ini sudah pernah digigit pola kegagalan
yang sama persis ketika `catalog/deployment-approval.json` terhapus rsync dan gerbang katalog
tertutup diam-diam. Tarikan berkala membuat watch yang telanjur mati **sembuh sendiri**
alih-alih diam sampai ada pelanggan mengeluh tidak dibalas.

Pembersihan isi email sebelum masuk ke `Message.content`: buang riwayat terkutip
(`> On … wrote:`), signature, dan disclaimer. Tanpa itu, draf yang dibuat dari email keempat
dalam satu benang akan menjawab pertanyaan dari email pertama.

### 6.4 Klasifikasi email otomatis

Setiap email masuk dilabeli otomatis: `LEAD`, `OPERASIONAL`, atau `BISING`.

**Label, bukan gerbang.** Semua email tetap masuk dan tetap terlihat. Label hanya mengatur
urutan, filter, dan hitungan belum-dibaca di tab Email — ia tidak pernah membuang, menunda,
atau menyembunyikan apa pun. Alasannya sama dengan §5: penyaring yang bisa membuang sesuatu
diam-diam akan berbohong tanpa ada yang tahu, dan lead yang hilang karena salah vonis tidak
akan pernah dilaporkan siapa pun. Label yang meleset langsung terlihat dan bisa dikoreksi.

**Modelnya `qwen2.5:latest`, lokal, dan bukan model produksi.** Ini keputusan privasi, bukan
biaya. `gemma4:31b-cloud` adalah tag cloud: daemon meneruskan teks ke ollama.com, jadi ia
keluar dari VPS (CLAUDE.md §2). Di WhatsApp isinya obrolan tur; di kotak masuk email bercampur
invoice supplier, notifikasi bank, dan surat pribadi. Klasifikasi otomatis berarti **setiap**
email harus dibaca model, jadi modelnya harus yang tidak mengirim ke mana pun.

Bukti kelayakan, diukur di VPS 2026-09-23 (`/api/tags` dan `free -g`):

| | Ukuran | Catatan |
| --- | --- | --- |
| VPS | 15 GB RAM, 10 GB tersedia, 4 core, tanpa GPU | Dipakai bersama Postgres + Next.js + bot |
| `gemma4:e4b` (8B) | 9,61 GB | Muat, tapi nyaris menghabiskan sisa RAM |
| **`qwen2.5:latest` (1.5B)** | **0,99 GB** | Dipilih — lega dan cepat di 4 core |

1.5B cukup karena memilah tiga label jauh lebih mudah daripada menyusun jawaban, dan karena
label tidak menggerbang apa pun: label yang meleset memakan satu lirikan operator, bukan lead
yang hilang. Yang 8B akan berebut RAM dan CPU dengan hal yang benar-benar mendesak — pelanggan
WhatsApp yang sedang menunggu balasan. **Pelabelan email tidak boleh pernah memperlambat itu.**

**Koreksi operator menang permanen.** Sekali operator mengubah label sebuah benang, klasifikasi
otomatis tidak boleh menimpanya lagi. Ini pelajaran yang sama dengan §5: dua penulis untuk satu
keputusan berarti salah satunya diam-diam jadi no-op.

```prisma
enum MailLabel {
  LEAD
  OPERASIONAL
  BISING
}

model Conversation {
  /// Hanya untuk EMAIL. Null = belum sempat dilabeli (misal pelabel sedang mati).
  mailLabel         MailLabel?
  /// True setelah operator mengoreksi. Pelabel otomatis TIDAK BOLEH menimpa yang true.
  mailLabelIsManual Boolean   @default(false)
}
```

Pelabel yang mati harus membuat email **tetap masuk tanpa label**, bukan menahannya. `mailLabel`
null berarti "belum dilabeli", dan benang tanpa label muncul di urutan teratas supaya kegagalan
pelabel terlihat sebagai tumpukan yang mencurigakan, bukan sebagai keheningan.

---

## 7. Alur keluar

`src/lib/send.ts` saat ini percabangan `if (channel === 'OFFICIAL')` — Meta vs coexist, dua
jalur WhatsApp. Yang ditambahkan adalah **cabang di level platform lebih dulu**, lalu
percabangan `MessageChannel` yang ada tetap berlaku di dalam cabang WhatsApp:

```
platform?
├─ WHATSAPP  → percabangan OFFICIAL / UNOFFICIAL yang sudah ada (tidak disentuh)
├─ INSTAGRAM → Graph API send (IG)
├─ FACEBOOK  → Graph API send (Page)
└─ EMAIL     → Gmail messages.send, threadId + In-Reply-To dipertahankan,
               FROM = Conversation.mailAccount.emailAddress
```

Balasan email lewat Gmail API ikut masuk folder **Sent** di Gmail. Siapa pun yang membuka
Gmail melihat percakapan yang sama — tidak ada dua kenyataan.

---

## 8. UI

**Tab tumbuh seiring channel-nya jadi — bukan lima tab tetap dengan tiga menunggu kosong.**
Keputusan operator 2026-09-24, merevisi desain awal.

| Setelah fase | Tab yang tampil |
| --- | --- |
| Fondasi (sekarang) | — belum ada tab; satu channel tidak butuh penyaring |
| Facebook | Semua · **WhatsApp** (default) · Facebook |
| Instagram | Semua · **WhatsApp** · Facebook · Instagram |
| Email | Semua · **WhatsApp** · Facebook · Instagram · Email |

Daftarnya berasal dari satu konstanta `SHIPPED_PLATFORMS` di kode, yang bertambah satu entri
per fase — **bukan** diturunkan dari data. Kalau diturunkan dari data, tab Facebook baru
muncul saat pesan Facebook pertama tiba, jadi operator tidak punya cara melihat bahwa channel
itu sudah hidup sebelum ada yang menulis. Tab yang berkedip-kedip mengikuti isi tabel juga
membuat orang ragu apakah ia salah lihat.

Tab kosong lebih buruk daripada tidak ada tab: ia menjanjikan sesuatu yang tidak bisa
diberikan, dan tidak ada cara membedakannya dari channel yang rusak.

Hitungan belum-dibaca per tab. Satu benang = satu baris, dengan badge platform.

Di tab Email, `mailLabel` (§6.4) mengurutkan: benang **tanpa label** di atas (kegagalan
pelabel harus terlihat), lalu `LEAD`, lalu `OPERASIONAL`, lalu `BISING`. Badge belum-dibaca
tab Email hanya menghitung `LEAD` dan benang tanpa label — `BISING` tidak pernah menuntut
perhatian, tapi tetap ada dan tetap bisa dibuka. Label bisa diganti operator langsung dari
baris itu, dan sekali diganti ia terkunci dari pelabel otomatis.

Badge platform berbeda dari `Conversation.orderChannel` yang sudah ada — yang itu asal
**booking** (Klook/JVTO/TWT), bukan channel pesan. Keduanya tampil berdampingan.

**Sakelar bot per channel** di `/chatbot`: empat toggle, masing-masing menulis massal ke
percakapan platform tersebut.

**Tombol "Generate draf"** sudah ada di `src/components/inbox/MessageBubble.tsx` dan berlaku
untuk semua channel begitu jalur kirimnya sadar-platform. Tidak ada UI baru untuk ini.

---

## 9. Urutan pelaksanaan

Mengikuti urutan migrasi destruktif yang terbukti di CLAUDE.md §7:
cadangkan → SELECT verifikasi → migrasi aditif → deploy kode → verifikasi sehat → migrasi destruktif.

**Fase 1 — fondasi identitas.** Belum ada channel baru. Tambah `Platform`, `ChannelIdentity`,
kolom baru di `Conversation` (semua aditif, nullable). Backfill: tiap `Contact` dapat satu
`ChannelIdentity(WHATSAPP, phone)`, tiap `Conversation` ditunjuk ke sana. Deploy. Verifikasi
jumlah baris cocok. **Baru kemudian** lepas `Contact.phone @unique` dan
`Conversation.contactId @unique`.

**Fase 2 — sakelar bot per channel.** Empat kolom `Settings`, empat toggle, `defaultBotEnabled`
menerima `platform`. Belum ada channel baru, tapi sakelarnya siap. Dipisah dari fase 1 supaya
perubahan gerbang bot tidak bercampur dengan migrasi skema saat ada yang perlu di-rollback.

**Fase 3 — Email.** Tidak butuh App Review Meta, jadi tidak menunggu siapa pun. `MailAccount`,
OAuth dua kotak surat, `watch()` + Pub/Sub + cron pengaman, pembersih kutipan, pengiriman via
Gmail API. Alur drafnya sudah ada.

**Fase 3b — pelabel otomatis.** Dipisah dari fase 3 dengan sengaja: email harus terbukti masuk,
terbaca, dan terbalas lebih dulu. Pelabel adalah lapisan kenyamanan di atas itu, dan memisahkannya
berarti pelabel yang buruk bisa dimatikan tanpa mematikan emailnya. Urutan ini juga memberi data
nyata untuk menilai akurasi `qwen2.5:latest` sebelum ia dipercaya mengurutkan apa pun.

**Fase 4 — Instagram DM + Facebook Messenger.** Satu fase karena payload dan adapternya
identik. Bergantung pada App Review Meta (`instagram_manage_messages`, `pages_messaging`) —
proses akun, di luar kendali kode, dan biasanya yang paling lama.

Fase 3 sengaja mendahului fase 4: ia membuktikan fondasi multi-benang benar-benar jalan
tanpa bergantung pada persetujuan pihak luar.

---

## 10. Risiko

| Risiko | Penanganan |
| --- | --- |
| Melepas dua `@unique` di tabel produksi | Aditif + backfill + verifikasi dulu; destruktif belakangan. Cadangkan sebelum mulai. |
| `watch()` Gmail mati diam-diam tiap 7 hari | Tarikan cron 15 menit yang sekaligus memperpanjang — bukan sekadar pengganti. |
| Sakelar channel menimpa override per-chat | Diterima sadar; konsisten dengan sakelar global yang sudah ada. |
| Filter `skipBotForIndonesianNumbers` tampak berlaku di IG/FB tapi tidak | Dijaga eksplisit ke `WHATSAPP`, bukan dibiarkan gagal diam-diam lewat regex yang tidak cocok. |
| Riwayat terkutip email meracuni prompt | Pembersih kutipan sebelum menulis `Message.content`; butuh test dengan email balasan berlapis. |
| Token OAuth bocor | `MailAccount.refreshToken` tidak pernah masuk API response, UI, atau audit log (CLAUDE.md §5). |
| Isi email pribadi keluar dari VPS lewat pelabel | Pelabel memakai model **lokal** (`qwen2.5:latest`), bukan `gemma4:31b-cloud`. Wajib ada test yang gagal kalau pelabel dipanggil dengan tag ber-`-cloud`. |
| Pelabel 1.5B salah vonis | Label tidak menggerbang: semua email tetap masuk dan terlihat. Koreksi operator mengunci benang itu dari pelabel otomatis. |
| Pelabel mati diam-diam | `mailLabel` null = belum dilabeli, dan benang tanpa label muncul **di atas** — kegagalan menumpuk secara kasatmata, bukan hilang. |
| Pelabel merebut RAM/CPU dari balasan WhatsApp | Model 1.5B (0,99 GB) dipilih atas 8B (9,61 GB) justru karena ini; VPS hanya punya 10 GB tersedia dan 4 core tanpa GPU. |

---

## 11. Yang sengaja TIDAK dibangun

- **Pembuangan** email otomatis. Klasifikasi melabeli (§6.4); ia tidak pernah membuang,
  menahan, atau menyembunyikan.
- Autoreply email. Pelabel hanya melabeli — ia tidak menyusun maupun mengirim jawaban.
- Pemakaian model cloud untuk pelabelan.
- Komentar IG/FB.
- Penggabungan identitas otomatis lintas platform.
- Nilai baru di enum `MessageChannel`.

---

## 12. Verifikasi dokumen ini

Setiap path dan identifier yang dikutip di atas diperiksa mekanis oleh
`docs/superpowers/specs/check-omnichannel-design.mjs`. Skrip itu keluar dengan kode ≠ 0 kalau
ada yang tidak lagi cocok dengan repo — yang berarti dokumen ini sudah usang, bukan repo yang
salah. Jalankan ulang sebelum memakai dokumen ini sebagai dasar implementasi.

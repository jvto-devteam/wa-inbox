# Omnichannel Fase Email (Gmail) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) atau superpowers:executing-plans untuk mengeksekusi rencana ini tugas demi tugas. Langkah memakai sintaks checkbox (`- [ ]`).

**Goal:** Email yang masuk ke kotak surat Google milik JVTO mendarat di Inbox wa-inbox sebagai satu benang per thread Gmail, bisa dibalas dari Inbox (termasuk lewat "Generate draf"), dan balasannya keluar dari alamat yang disurati serta tetap satu thread di Gmail.

**Architecture:** Tiga lapis baru di `src/lib/gmail/`: klien HTTP tipis ke Gmail API dan OAuth (tanpa dependensi npm baru, sama seperti modul Meta), parser + pembersih isi email, lalu ingest/sync yang menulis ke `ChannelIdentity(EMAIL)` + `Conversation(externalThreadId = threadId Gmail)`. Email masuk lewat dua pintu: push Pub/Sub (bel pintu, isinya hanya "ada perubahan") dan tarikan cron 15 menit yang sekaligus memperpanjang `watch()`. Kirim keluar menjadi cabang platform `EMAIL` di `src/lib/send.ts`. **Bot tidak pernah menjawab email otomatis** — draf manual saja, lewat alur `message-draft.ts` yang sudah ada.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Prisma 7, PostgreSQL, Vitest + vitest-mock-extended, Gmail API v1 (REST), Google OAuth 2.0, Google Cloud Pub/Sub (push).

**Spec:** `docs/superpowers/specs/2026-09-23-omnichannel-inbox-design.md` (§2, §3.1, §4.2, §4.3, §6.3, §7, §8, §9 Fase 3, §10, §11). **Fase 3b (pelabel otomatis `LEAD`/`OPERASIONAL`/`BISING`) TIDAK termasuk rencana ini** — spesnya sengaja memisahkannya: email harus terbukti masuk, terbaca, dan terbalas lebih dulu.

**Pemeriksa spec:** `node docs/superpowers/specs/check-omnichannel-design.mjs` — harus exit 0 sebelum DAN sesudah setiap tugas. Tugas 1, 8, dan 12 mengubah klaimnya; tugas lain tidak boleh membuatnya merah.

---

## Global Constraints

Disalin dari `CLAUDE.md` dan spec. Setiap tugas terikat semuanya.

- **Dilarang `any`.** Pakai `unknown` atau tipe yang sesuai.
- **Jangan pernah menampilkan token/API key** di UI, API response, audit log, log server, atau dokumen ekspor apa pun. `MailAccount.refreshToken` dan access token Google **tidak pernah** masuk `console.*`, `NextResponse.json`, atau `lastSyncError`. Yang boleh ditulis ke log hanyalah `GmailError.kind` dan status HTTP.
- **Bot di email: draf manual saja.** Tidak ada jalur yang memanggil `scheduleBotRun` / `runBotForConversation` untuk percakapan EMAIL. Percakapan EMAIL lahir dengan `botEnabled: false`.
- **Label, bukan gerbang — dan belum ada label.** Rencana ini tidak membuang email apa pun berdasarkan isinya. Satu-satunya yang dilewati adalah yang **Gmail sendiri** taruh di `SPAM`, `TRASH`, `DRAFT`, atau `CHAT` (lihat Keputusan D2).
- **Balasan keluar dari alamat yang disurati** (spec §4.3): `From` = `Conversation.mailAccount.emailAddress`, tidak pernah disimpulkan.
- **Gerbang runtime bot tetap SATU:** `Conversation.botEnabled`.
- **`MessageChannel` tidak disentuh.** Pesan email ditulis dengan `channel: 'OFFICIAL'`, sama seperti Messenger ("panggilan API langsung, bukan antrean Unofficial").
- **Jangan uji ke alamat/nomor pelanggan sungguhan.** Uji email hanya dari dan ke kotak surat milik sendiri.
- **Dilarang `npx prisma migrate dev`** terhadap database produksi. Migrasi dibuat offline dengan `prisma migrate diff`, diperiksa, lalu `prisma migrate deploy` (CLAUDE.md §7). Migrasi rencana ini **aditif murni**.
- **Sebelum commit:** `npm test`, `npx tsc --noEmit`, `npx eslint .` (0 error, warning boleh).
- **Deploy:** `npm run build` LOKAL dulu; restart VPS hanya kalau build exit 0; nvm Node 22 wajib diekspor **di perintah yang sama** dengan `pm2`/`prisma`.
- **Tab tidak boleh muncul sebelum jalurnya benar-benar bekerja** (spec §8). Penyalaan tab Email adalah tugas TERAKHIR (Tugas 12), setelah uji ujung-ke-ujung di produksi.

## Review Focus

Lima kondisi yang spesnya siratkan tapi mudah lolos, dari yang paling mungkin menggigit. Masing-masing sudah punya test di tugas pemiliknya.

1. **Email hanya-HTML** (notifikasi booking, newsletter, balasan dari Outlook) harus jadi teks yang terbaca — tanpa tag, CSS, atau riwayat kutipan `gmail_quote`/`blockquote`, tapi email **terusan** (forward) tetap utuh. → Tugas 3.
2. **Header non-ASCII** (`Subject: =?UTF-8?B?...?=`, nama pengirim ber-aksen) terbaca benar saat masuk, dan subjek balasan ber-emoji/aksen di-encode benar saat keluar. → Tugas 3 (masuk), Tugas 8 (keluar).
3. **Email yang sama tiba dua kali** — push dan cron berjalan bersamaan, atau Pub/Sub mengulang — menghasilkan **tepat satu** baris `Message`. → Tugas 5 (P2002 dilewati bersih) dan Tugas 6 (single-flight per kotak surat).
4. **Refresh token dicabut** (password diganti, akses app dicabut di akun Google) — sinkronisasi mencatat `AUTH_REVOKED` yang terlihat di panel dengan ajakan "sambung ulang", dan kotak surat **lain** tetap tersinkron. → Tugas 6 dan Tugas 9.
5. **Admin membalas langsung dari Gmail web**, bukan dari Inbox — balasannya muncul di benang yang sama sebagai pesan keluar, bukan sebagai percakapan pelanggan baru; dan balasan yang dikirim dari Inbox **tidak** muncul dua kali saat salinan `SENT`-nya tersinkron balik. → Tugas 5.

---

## Keputusan yang diambil rencana ini (tolak saat review kalau tidak setuju)

Spec tidak menjawab hal-hal di bawah ini secara eksplisit, atau jawabannya saling bertentangan. Masing-masing diputuskan di sini dengan alasan, bukan ditebak diam-diam di dalam kode.

| # | Keputusan | Alasan |
| --- | --- | --- |
| **D1** | **Sakelar bot "Email" di `/chatbot` dilepas**, dan `POST /api/bot/channel-toggle` menolak `EMAIL`. Kolom `Settings.botEnabledEmail` tetap ada (tidak ada migrasi destruktif), dipaksa `false` sekali oleh migrasi. | Spec bertentangan dengan dirinya sendiri: §1/§2 menyebut "empat sakelar", tapi §2 ("Bot di email: draf manual saja"), §11 ("Autoreply email" tidak dibangun), dan tidak adanya jalur bot untuk email membuat sakelar keempat itu **tidak melakukan apa pun**. Sakelar yang tampak menyala tapi tidak mengubah apa-apa adalah persis kelas bug yang dilarang §5. |
| **D2** | Email berlabel Gmail `SPAM`, `TRASH`, `DRAFT`, `CHAT` dilewati. Kategori Promosi/Sosial/Update **tetap masuk**. | Itu vonis Gmail, bukan penyaring buatan kita; folder spam bukan kotak masuk. Semua yang lain masuk, sesuai "semua email tetap masuk" (§2). |
| **D3** | **Tidak ada impor email lama.** Kursor dimulai dari saat kotak surat disambungkan. Kalau kursor kedaluwarsa (Gmail menjawab 404), sinkronisasi memulihkan diri dengan menarik 7 hari terakhir. | Impor riwayat bertahun-tahun ke Inbox bukan permintaan operator, dan akan membanjiri tab dengan ribuan benang yang sudah selesai. Pemulihan 7 hari idempoten karena `Message.externalId @unique`. |
| **D4** | Email **keluar** yang dikirim dari Gmail web hanya dicatat kalau benangnya sudah ada di Inbox. Email keluar yang membuka benang baru (JVTO menyurati duluan) tidak membuat percakapan. | Inbox adalah tempat membalas pelanggan yang menulis. Benang yang dibuka JVTO akan muncul begitu pelanggan membalas. |
| **D5** | Dua kolom tambahan di luar §4.2: `MailAccount.lastSyncAt` dan `MailAccount.lastSyncError`. | Spec §6.3 sendiri menyebut kegagalan `watch()` yang **diam**. Tanpa dua kolom ini, token yang dicabut juga diam — email berhenti masuk dan tidak ada yang tahu. |
| **D6** | Push Pub/Sub diautentikasi dengan **token rahasia di query string** (`?token=`), bukan JWT OIDC. | Push hanya bel pintu: payload-nya tidak dipercaya untuk isi apa pun (isi selalu diambil ulang dari Gmail dengan kredensial kita). Push palsu paling jauh memicu satu sinkronisasi ekstra. Token dicek timing-safe dengan panjang minimum yang sama dengan `OUTBOUND_CRON_SECRET`. |
| **D7** | Tanpa dependensi npm baru (`googleapis`, `mailparser`, `nodemailer` tidak dipakai). | Tiga modul Meta di repo ini sudah memakai `fetch` langsung. Permukaan API yang dipakai kecil (8 endpoint), dan fetch yang di-mock lebih mudah diuji daripada SDK. |
| **D8** | Balasan hanya ke alamat `ChannelIdentity.externalId` (pengirim pertama benang). CC tidak diteruskan. | Paling sederhana dan tidak pernah salah kirim ke pihak ketiga. Kalau operator butuh reply-all, itu fitur tersendiri. |
| **D9** | Lampiran email **masuk** dicatat sebagai baris `[Lampiran: nama-file.pdf]`, tidak diunduh. Lampiran **keluar** ditolak terlihat (bubble FAILED dengan alasan). | Sama persis dengan keputusan yang sudah diambil untuk Messenger (`attachmentPlaceholder`, `sendMessengerMessage`). |

## Kotak surat yang disambungkan (dijawab operator 2026-09-28)

1. `hello@javavolcano-touroperator.com` — Google Workspace.
2. `javavolcanotouroperator@gmail.com` — akun Gmail pribadi, **di luar** Workspace.

Konsekuensinya untuk Tugas 11: layar izin OAuth **tidak bisa Internal**, karena akun `@gmail.com` tidak termasuk organisasi Workspace. Layar izin harus **External**, dan statusnya harus **In production**. App External berstatus "Testing" mendapat refresh token yang **mati setelah 7 hari**, dan kotak surat akan berhenti tersinkron tiap minggu. Scope Gmail tergolong *restricted*. Bagaimana app yang belum diverifikasi diperlakukan (layar peringatan "app belum diverifikasi", batas jumlah pengguna) harus dicek di konsol saat menyiapkan — **rencana ini tidak mengklaim jawabannya**. Kode tidak berubah karena ini. Panel Pengaturan sudah menampilkan `AUTH_REVOKED` kalau token ternyata mati.

---

## Keadaan awal, terverifikasi 2026-09-28

Diperiksa langsung dari kode, bukan dari dokumen:

| Bagian | Status | Bukti |
| --- | --- | --- |
| `enum Platform` memuat `EMAIL` | **ada** | `prisma/schema.prisma` |
| `Conversation.externalThreadId String @default("")` + `@@unique([channelIdentityId, externalThreadId])` | **ada** — komentarnya sudah menyiapkan threadId Gmail | `prisma/schema.prisma` |
| `Settings.botEnabledEmail` | **ada**, default `false` | `prisma/schema.prisma` |
| Sakelar Email di UI `/chatbot` | **ada** (akan dilepas, D1) | `src/app/(authenticated)/chatbot/page.tsx` (`PLATFORM_LABELS.EMAIL`) |
| `POST /api/bot/channel-toggle` menerima `EMAIL` | **ada** (akan ditolak, D1) | `src/app/api/bot/channel-toggle/route.ts` (`z.enum([... 'EMAIL'])`) |
| `upsertChannelIdentity` tahan balapan P2002 | **ada** | `src/lib/channel/identity.ts` |
| Alur draf manual `generateDraft` → `sendDraft` → `sendMessage` | **ada** | `src/lib/inbox/message-draft.ts` |
| `sendMessage` menurunkan platform dari `conversation.channelIdentity` | **ada**; tipe `platform` belum memuat `EMAIL` | `src/lib/send.ts` |
| `model MailAccount`, `Conversation.mailAccountId`, `Conversation.subject` | **BELUM** | `prisma/schema.prisma` |
| Kode Gmail apa pun | **BELUM** | tidak ada `src/lib/gmail/` |
| Tab Email | **BELUM** | `SHIPPED_PLATFORMS = ['WHATSAPP', 'FACEBOOK', 'INSTAGRAM']` |
| Cookie sesi terkirim saat Google mengarahkan balik ke callback OAuth | **ya** — `sameSite: 'lax'` mengizinkan navigasi GET tingkat atas | `src/app/api/auth/login/route.ts` |
| `hasValidCronSecret` + `CRON_PATHS` exact-match | **ada** | `src/lib/outbound/cron-auth.ts`, `src/middleware.ts` |

## Fakta Gmail API yang mengikat rencana ini

Semua endpoint di bawah `https://gmail.googleapis.com/gmail/v1/users/me`, header `Authorization: Bearer <access token>`.

| Kebutuhan | Endpoint | Catatan |
| --- | --- | --- |
| Alamat + kursor awal | `GET /profile` | `{ emailAddress, historyId }` |
| Pasang/perpanjang push | `POST /watch` body `{ topicName, labelIds: ['INBOX','SENT'], labelFilterBehavior: 'INCLUDE' }` | Jawaban `{ historyId, expiration }`, `expiration` = epoch ms dalam string. **Kedaluwarsa 7 hari.** |
| Perubahan sejak kursor | `GET /history?startHistoryId=&historyTypes=messageAdded&pageToken=` | Jawaban `{ history?: [{ messagesAdded?: [{ message: { id, threadId, labelIds } }] }], nextPageToken?, historyId }`. **404 = kursor terlalu tua.** |
| Pemulihan | `GET /messages?q=&pageToken=` | `{ messages?: [{ id, threadId }], nextPageToken? }` |
| Isi satu email | `GET /messages/{id}?format=full` | `payload` = pohon MIME, `body.data` base64url, `internalDate` epoch ms dalam string |
| Header untuk membalas | `GET /messages/{id}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=References&metadataHeaders=Subject` | Nama header di jawaban mengikuti ejaan pengirim (`Message-Id` vs `Message-ID`) — **bandingkan tanpa peka huruf** |
| Kirim | `POST /messages/send` body `{ raw, threadId }` | `raw` = MIME RFC 2822 dalam base64url. Otomatis masuk folder Sent. |

OAuth:
- Otorisasi: `https://accounts.google.com/o/oauth2/v2/auth` dengan `access_type=offline` dan `prompt=consent`. Tanpa `prompt=consent`, sambung ulang tidak mengembalikan `refresh_token`.
- Token: `POST https://oauth2.googleapis.com/token` (form-urlencoded). `grant_type=authorization_code` untuk callback, `grant_type=refresh_token` untuk sinkronisasi. Refresh token yang dicabut dijawab **400 `{"error":"invalid_grant"}`**.
- Scope: `https://www.googleapis.com/auth/gmail.readonly` dan `https://www.googleapis.com/auth/gmail.send`. **Layar izin Google membolehkan pengguna tidak mencentang sebagian scope**, jadi callback wajib memeriksa field `scope` di jawaban token.

Push Pub/Sub: body `{ message: { data: base64(JSON{ emailAddress, historyId }), messageId }, subscription }`. Status 2xx = ack; selain itu Pub/Sub mengulang.

**Belum diverifikasi dan harus dicek saat Tugas 2:** nama field `labelFilterBehavior` beserta nilai enumnya (`'INCLUDE'`). Dokumentasi Gmail pernah memakai `labelFilterAction: 'include'`. Buka `developers.google.com/workspace/gmail/api/reference/rest/v1/users/watch` sebelum commit Tugas 2, lalu sesuaikan konstanta **dan** test-nya kalau berbeda.

---

## File Structure

| File | Tanggung jawab | Tugas |
| --- | --- | --- |
| `prisma/schema.prisma` | `model MailAccount`, `Conversation.mailAccountId/subject`, `@@unique([mailAccountId, externalThreadId])` | 1 |
| `prisma/migrations/20260928100000_email_mail_account/migration.sql` | migrasi aditif + `botEnabledEmail=false` | 1 |
| `src/lib/gmail/errors.ts` | `GmailError` + `kind` | 2 |
| `src/lib/gmail/oauth.ts` | URL otorisasi, tukar code, refresh token | 2 |
| `src/lib/gmail/client.ts` | cache access token + 7 panggilan Gmail API | 2 |
| `src/lib/gmail/types.ts` | tipe respons Gmail | 2 |
| `src/lib/gmail/parse.ts` | pohon MIME → `ParsedEmail` (header, alamat, isi, lampiran) | 3 |
| `src/lib/gmail/clean-body.ts` | buang kutipan, signature, footer ponsel; batas panjang | 4 |
| `src/lib/gmail/ingest.ts` | satu email → identitas + benang + `Message` | 5 |
| `src/lib/gmail/sync.ts` | kursor history, pemulihan 404, perpanjang watch, single-flight | 6 |
| `src/lib/gmail/push-auth.ts` | cek token push Pub/Sub | 7 |
| `src/app/api/webhooks/gmail/route.ts` | bel pintu Pub/Sub | 7 |
| `src/app/api/email/sync/route.ts` | tarikan cron 15 menit + tombol admin | 7 |
| `src/app/api/mail-accounts/route.ts` | daftar kotak surat (tanpa token) | 7 |
| `src/app/api/mail-accounts/oauth/start/route.ts` | mulai OAuth | 7 |
| `src/app/api/mail-accounts/oauth/callback/route.ts` | selesaikan OAuth, simpan akun | 7 |
| `src/middleware.ts` | `/api/webhooks/gmail` publik, `/api/email/sync` jalur cron | 7 |
| `src/lib/gmail/mime.ts` | susun MIME balasan (header aman, RFC 2047) | 8 |
| `src/lib/gmail/send.ts` | jalur kirim EMAIL | 8 |
| `src/lib/send.ts` | cabang `platform === 'EMAIL'` | 8 |
| `src/components/settings/MailAccountsPanel.tsx` | panel "Kotak surat email" | 9 |
| `src/app/(authenticated)/settings/page.tsx` | bagian `kotak-surat` + `?section=` | 9 |
| `src/app/api/conversations/route.ts`, `src/app/api/conversations/[id]/route.ts` | kirim `subject` + `platform` | 10 |
| `src/components/inbox/ConversationListItem.tsx`, `src/components/inbox/ThreadView.tsx` | subjek tampil, tombol/ikon bot hilang untuk EMAIL | 10 |
| `src/app/(authenticated)/chatbot/page.tsx`, `src/app/api/bot/channel-toggle/route.ts` | lepas sakelar Email (D1) | 10 |
| `src/lib/channel/platform.ts` | `EMAIL` masuk `SHIPPED_PLATFORMS` | 12 |
| `docs/superpowers/specs/check-omnichannel-design.mjs`, spec, `CLAUDE.md` | klaim dan dokumen menyusul kode | 1, 8, 12 |

Test berdampingan dengan file-nya (`*.test.ts`/`*.test.tsx`), sesuai konvensi repo.

---

## Task 1: Skema `MailAccount` + kolom email di `Conversation`

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260928100000_email_mail_account/migration.sql`
- Modify: `docs/superpowers/specs/check-omnichannel-design.mjs` (baris klaim `model MailAccount`)

**Interfaces:**
- Produces: `prisma.mailAccount` dengan field `id, emailAddress, refreshToken, historyId, watchExpiresAt, lastSyncAt, lastSyncError, createdAt`; `Conversation.mailAccountId: string | null`, `Conversation.subject: string | null`, relasi `Conversation.mailAccount`.

- [ ] **Step 1: Tambah model dan kolom**

Di `prisma/schema.prisma`, tepat setelah blok `model WaNumber { ... }`, tambahkan:

```prisma
/// Kotak surat MILIK JVTO (bukan pelanggan). Meniru bentuk WaNumber: satu baris per kotak
/// surat yang disambungkan lewat OAuth dari panel Pengaturan -> Kotak surat email.
model MailAccount {
  id             String    @id @default(cuid())
  /// Selalu huruf kecil. Push Pub/Sub menyebut kotak surat lewat alamat ini, jadi ejaannya
  /// harus satu -- "Hello@" dan "hello@" yang tersimpan sebagai dua baris berarti push untuk
  /// salah satunya tidak pernah menemukan akunnya.
  emailAddress   String    @unique
  /// Token OAuth. TIDAK PERNAH keluar ke UI, API response, audit log, atau log server
  /// (CLAUDE.md §5). Setiap pembaca memakai `select` eksplisit tanpa kolom ini.
  refreshToken   String
  /// Kursor Gmail history.list. Null = belum pernah tersinkron.
  historyId      String?
  /// watch() Gmail mati tiap 7 hari. Null / lewat = harus diperpanjang (src/lib/gmail/sync.ts).
  watchExpiresAt DateTime?
  /// Sinkronisasi TERAKHIR YANG BERHASIL. Dipisah dari lastSyncError supaya panel bisa
  /// menunjukkan "terakhir berhasil 3 jam lalu" saat sinkronisasi sedang gagal -- kegagalan
  /// yang tidak menampilkan umurnya terlihat sama dengan kegagalan yang baru saja terjadi.
  lastSyncAt     DateTime?
  /// Kategori kegagalan terakhir (MailSyncError di src/lib/gmail/sync.ts), null = sehat.
  /// Hanya kategori tetap, TIDAK PERNAH teks error mentah: teks dari Google bisa berubah
  /// bentuk, dan kolom ini tampil di UI.
  lastSyncError  String?
  createdAt      DateTime  @default(now())

  conversations Conversation[]
}
```

Di `model Conversation`, tepat setelah baris `externalThreadId String @default("")` (sebelum `@@unique([channelIdentityId, externalThreadId])`), tambahkan:

```prisma
  /// Hanya untuk EMAIL: kotak surat JVTO mana yang disurati. Menentukan alamat pengirim
  /// balasan (spec §4.3) -- disimpan eksplisit, tidak pernah disimpulkan. Orang yang sama
  /// menyurati dua alamat JVTO = dua benang. Itu benar, bukan bug.
  mailAccountId String?
  mailAccount   MailAccount? @relation(fields: [mailAccountId], references: [id])
  /// Hanya untuk EMAIL: subjek benang saat lahir.
  subject       String?
```

Dan di bawah `@@unique([channelIdentityId, externalThreadId])`, tambahkan:

```prisma
  /// Satu thread Gmail di satu kotak surat = satu percakapan, siapa pun pengirimnya. Tanpa
  /// ini, istri pelanggan yang ikut membalas di thread yang sama melahirkan percakapan kedua
  /// (kunci di atas memakai channelIdentityId, dan identitasnya berbeda). Baris non-email
  /// punya mailAccountId NULL, dan Postgres menganggap setiap NULL berbeda -- jadi indeks ini
  /// tidak mengekang WhatsApp/Instagram/Facebook sama sekali.
  @@unique([mailAccountId, externalThreadId])
```

- [ ] **Step 2: Generate client dan cek tipe**

Run: `npx prisma generate && npx tsc --noEmit`
Expected: exit 0. Field baru belum dipakai di mana pun.

- [ ] **Step 3: Buat SQL migrasi secara offline**

```bash
SCRATCH=$(mktemp -d)
git show HEAD:prisma/schema.prisma > "$SCRATCH/schema-lama.prisma"
npx prisma migrate diff --from-schema "$SCRATCH/schema-lama.prisma" --to-schema prisma/schema.prisma --script
```

Expected: SQL yang **isinya setara** dengan blok di bawah ini (urutan boleh beda). Simpan blok di bawah ke `prisma/migrations/20260928100000_email_mail_account/migration.sql`, lalu bandingkan baris demi baris dengan keluaran `migrate diff`. **Kalau keluaran `diff` memuat `DROP`, `TRUNCATE`, atau `ALTER COLUMN`, BERHENTI** — skema lokal tidak sinkron dengan HEAD dan harus diselidiki dulu.

```sql
-- Fase email (docs/superpowers/plans/2026-09-28-omnichannel-email.md, Tugas 1). Aditif murni.

CREATE TABLE "MailAccount" (
    "id" TEXT NOT NULL,
    "emailAddress" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "historyId" TEXT,
    "watchExpiresAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MailAccount_emailAddress_key" ON "MailAccount"("emailAddress");

ALTER TABLE "Conversation" ADD COLUMN "mailAccountId" TEXT;
ALTER TABLE "Conversation" ADD COLUMN "subject" TEXT;

CREATE UNIQUE INDEX "Conversation_mailAccountId_externalThreadId_key" ON "Conversation"("mailAccountId", "externalThreadId");

ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_mailAccountId_fkey" FOREIGN KEY ("mailAccountId") REFERENCES "MailAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Keputusan D1: bot tidak pernah menjawab email. Sakelar Email dilepas dari UI di Tugas 10;
-- nilai yang mungkin sempat dinyalakan lewat sakelar lama dinolkan sekali di sini supaya
-- POST /api/bot/mode (yang membaca sakelar per platform) tidak pernah menyalakan botEnabled
-- untuk percakapan email. Idempoten.
UPDATE "Settings" SET "botEnabledEmail" = false;
```

- [ ] **Step 4: Balik klaim pemeriksa spec**

Di `docs/superpowers/specs/check-omnichannel-design.mjs`, ganti:

```js
// §4 — fondasi SUDAH dibangun (2026-09-24); MailAccount masih menunggu fase email.
mustContain('prisma/schema.prisma', /^enum Platform /m, 'enum Platform')
mustContain('prisma/schema.prisma', /^model ChannelIdentity /m, 'model ChannelIdentity')
mustNotContain('prisma/schema.prisma', /^model MailAccount /m, 'model MailAccount (fase email, belum)')
```

menjadi:

```js
// §4 — fondasi SUDAH dibangun (2026-09-24); MailAccount SUDAH (fase email, 2026-09-28).
mustContain('prisma/schema.prisma', /^enum Platform /m, 'enum Platform')
mustContain('prisma/schema.prisma', /^model ChannelIdentity /m, 'model ChannelIdentity')
mustContain('prisma/schema.prisma', /^model MailAccount /m, 'model MailAccount')
// §4.3: alamat pengirim balasan disimpan eksplisit, bukan disimpulkan.
mustContain('prisma/schema.prisma', /mailAccountId String\?/, 'Conversation.mailAccountId')
mustContain('prisma/schema.prisma', /@@unique\(\[mailAccountId, externalThreadId\]\)/, 'satu thread Gmail = satu percakapan')
```

Run: `node docs/superpowers/specs/check-omnichannel-design.mjs`
Expected: exit 0, "✓ semua klaim ... masih cocok".

- [ ] **Step 5: Test suite + commit**

Run: `npm test && npx tsc --noEmit && npx eslint .`
Expected: semua hijau (tidak ada kode yang berubah perilakunya).

```bash
git add prisma/schema.prisma prisma/migrations/20260928100000_email_mail_account docs/superpowers/specs/check-omnichannel-design.mjs
git commit -m "feat(email): skema MailAccount dan kolom email di Conversation"
```

---

## Task 2: Klien Gmail API dan OAuth

**Files:**
- Create: `src/lib/gmail/errors.ts`, `src/lib/gmail/types.ts`, `src/lib/gmail/oauth.ts`, `src/lib/gmail/client.ts`
- Test: `src/lib/gmail/oauth.test.ts`, `src/lib/gmail/client.test.ts`

**Interfaces:**
- Produces (`errors.ts`): `class GmailError extends Error { kind: GmailErrorKind; status: number | null }`, `type GmailErrorKind = 'AUTH_REVOKED' | 'UNAUTHORIZED' | 'HISTORY_EXPIRED' | 'NOT_FOUND' | 'HTTP' | 'CONFIG'`.
- Produces (`types.ts`): `GmailHeader`, `GmailMessagePart`, `GmailMessage`, `GmailHistoryPage`.
- Produces (`oauth.ts`): `GMAIL_SCOPES`, `MAIL_OAUTH_STATE_COOKIE = 'mail_oauth_state'`, `buildGoogleAuthUrl(state: string): string`, `exchangeAuthCode(code: string): Promise<{ accessToken: string; refreshToken: string | null; grantedScopes: string[] }>`, `refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresInSec: number }>`.
- Produces (`client.ts`): `getAccessToken(account: { id: string; refreshToken: string }, nowMs?: number): Promise<string>`, `invalidateAccessToken(accountId: string): void`, `__resetTokenCacheForTests(): void`, `gmailGetProfile(token)`, `gmailWatch(token, topicName)`, `gmailListHistory(token, startHistoryId, pageToken?)`, `gmailListMessageIds(token, query)`, `gmailGetMessage(token, id): Promise<GmailMessage | null>`, `gmailGetMessageHeaders(token, id, names): Promise<Record<string, string>>`, `gmailSendRaw(token, raw, threadId): Promise<{ id: string; threadId: string }>`.

- [ ] **Step 1: Tulis test yang gagal**

`src/lib/gmail/oauth.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { buildGoogleAuthUrl, exchangeAuthCode, refreshAccessToken, GMAIL_SCOPES } from './oauth'
import { GmailError } from './errors'

beforeEach(() => {
  vi.stubEnv('GOOGLE_OAUTH_CLIENT_ID', 'client-id-uji')
  vi.stubEnv('GOOGLE_OAUTH_CLIENT_SECRET', 'client-secret-uji')
  vi.stubEnv('APP_BASE_URL', 'https://inbox.contoh.test/')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('buildGoogleAuthUrl', () => {
  it('meminta akses offline dengan prompt=consent dan kedua scope Gmail', () => {
    const url = new URL(buildGoogleAuthUrl('state-123'))
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(url.searchParams.get('access_type')).toBe('offline')
    // Tanpa prompt=consent, menyambung ulang kotak surat yang sama TIDAK mengembalikan
    // refresh_token -- dan token yang dicabut tidak akan pernah bisa diganti.
    expect(url.searchParams.get('prompt')).toBe('consent')
    expect(url.searchParams.get('scope')).toBe(GMAIL_SCOPES.join(' '))
    expect(url.searchParams.get('state')).toBe('state-123')
    // Garis miring di ujung APP_BASE_URL tidak boleh menghasilkan "//api".
    expect(url.searchParams.get('redirect_uri')).toBe('https://inbox.contoh.test/api/mail-accounts/oauth/callback')
  })

  it('melempar CONFIG kalau client id belum diisi', () => {
    vi.stubEnv('GOOGLE_OAUTH_CLIENT_ID', '')
    expect(() => buildGoogleAuthUrl('s')).toThrow(GmailError)
  })
})

describe('exchangeAuthCode', () => {
  it('mengembalikan refresh token dan scope yang benar-benar diberikan', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'at', refresh_token: 'rt', expires_in: 3599, scope: GMAIL_SCOPES.join(' ') }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await exchangeAuthCode('kode-1')

    expect(result).toEqual({ accessToken: 'at', refreshToken: 'rt', grantedScopes: [...GMAIL_SCOPES] })
    const body = String(fetchMock.mock.calls[0][1].body)
    expect(body).toContain('grant_type=authorization_code')
    expect(body).toContain('code=kode-1')
  })

  it('refreshToken null kalau Google tidak mengirimnya', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ access_token: 'at', expires_in: 3599, scope: '' }),
    }))
    expect((await exchangeAuthCode('k')).refreshToken).toBeNull()
  })
})

describe('refreshAccessToken', () => {
  it('invalid_grant menjadi AUTH_REVOKED', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 400, json: async () => ({ error: 'invalid_grant' }),
    }))
    await expect(refreshAccessToken('rt-mati')).rejects.toMatchObject({ kind: 'AUTH_REVOKED' })
  })

  it('pesan error tidak memuat refresh token', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 500, json: async () => ({ error: 'server_error' }),
    }))
    const error = await refreshAccessToken('rt-rahasia-sekali').catch((e: unknown) => e)
    expect(String((error as Error).message)).not.toContain('rt-rahasia-sekali')
  })
})
```

`src/lib/gmail/client.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { refreshAccessToken } from './oauth'
import {
  getAccessToken, invalidateAccessToken, __resetTokenCacheForTests,
  gmailListHistory, gmailGetMessage, gmailGetMessageHeaders, gmailWatch, gmailSendRaw,
} from './client'

vi.mock('./oauth', () => ({ refreshAccessToken: vi.fn() }))

beforeEach(() => {
  __resetTokenCacheForTests()
  vi.mocked(refreshAccessToken).mockReset().mockResolvedValue({ accessToken: 'at-1', expiresInSec: 3600 })
})
afterEach(() => vi.unstubAllGlobals())

const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json })

describe('getAccessToken', () => {
  const account = { id: 'mail_1', refreshToken: 'rt' }

  it('menyimpan token di cache sampai 60 detik sebelum kedaluwarsa', async () => {
    expect(await getAccessToken(account, 0)).toBe('at-1')
    expect(await getAccessToken(account, 3_000_000)).toBe('at-1')
    expect(refreshAccessToken).toHaveBeenCalledTimes(1)
    await getAccessToken(account, 3_550_000)
    expect(refreshAccessToken).toHaveBeenCalledTimes(2)
  })

  it('invalidateAccessToken memaksa refresh berikutnya', async () => {
    await getAccessToken(account, 0)
    invalidateAccessToken('mail_1')
    await getAccessToken(account, 1)
    expect(refreshAccessToken).toHaveBeenCalledTimes(2)
  })
})

describe('panggilan Gmail', () => {
  it('history 404 menjadi HISTORY_EXPIRED', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: { status: 'NOT_FOUND' } }) }))
    await expect(gmailListHistory('at', '100')).rejects.toMatchObject({ kind: 'HISTORY_EXPIRED' })
  })

  it('history meminta hanya messageAdded dan meneruskan pageToken', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({ historyId: '200' }))
    vi.stubGlobal('fetch', fetchMock)
    await gmailListHistory('at', '100', 'p2')
    const url = new URL(String(fetchMock.mock.calls[0][0]))
    expect(url.pathname).toBe('/gmail/v1/users/me/history')
    expect(url.searchParams.get('startHistoryId')).toBe('100')
    expect(url.searchParams.get('historyTypes')).toBe('messageAdded')
    expect(url.searchParams.get('pageToken')).toBe('p2')
  })

  it('message 404 menjadi null, bukan lemparan (email sudah dihapus sebelum sempat dibaca)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) }))
    expect(await gmailGetMessage('at', 'm1')).toBeNull()
  })

  it('401 menjadi UNAUTHORIZED', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }))
    await expect(gmailGetMessage('at', 'm1')).rejects.toMatchObject({ kind: 'UNAUTHORIZED' })
  })

  it('header balasan dikembalikan dengan kunci huruf kecil', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok({
      payload: { headers: [{ name: 'Message-Id', value: '<a@b>' }, { name: 'Subject', value: 'Bromo' }] },
    })))
    expect(await gmailGetMessageHeaders('at', 'm1', ['Message-ID', 'Subject'])).toEqual({ 'message-id': '<a@b>', subject: 'Bromo' })
  })

  it('watch mengirim topik dan filter label INBOX+SENT', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({ historyId: '5', expiration: '1760000000000' }))
    vi.stubGlobal('fetch', fetchMock)
    await gmailWatch('at', 'projects/p/topics/t')
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({
      topicName: 'projects/p/topics/t', labelIds: ['INBOX', 'SENT'], labelFilterBehavior: 'INCLUDE',
    })
  })

  it('send mengirim raw dan threadId', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({ id: 'gm_1', threadId: 'th_1' }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await gmailSendRaw('at', 'UkFX', 'th_1')).toEqual({ id: 'gm_1', threadId: 'th_1' })
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({ raw: 'UkFX', threadId: 'th_1' })
  })
})
```

- [ ] **Step 2: Jalankan, pastikan GAGAL**

Run: `npx vitest run src/lib/gmail`
Expected: FAIL — modul belum ada.

- [ ] **Step 3: Implementasi**

`src/lib/gmail/errors.ts`:

```ts
/**
 * Kesalahan dari Gmail API atau endpoint token Google, dengan KATEGORI tetap.
 *
 * `message` dibentuk dari status HTTP dan kode status Google saja, tidak pernah dari body
 * mentah dan tidak pernah dari token: pesannya berakhir di log server, dan `kind`-nya
 * berakhir di MailAccount.lastSyncError yang tampil di UI (CLAUDE.md §5).
 */
export type GmailErrorKind = 'AUTH_REVOKED' | 'UNAUTHORIZED' | 'HISTORY_EXPIRED' | 'NOT_FOUND' | 'HTTP' | 'CONFIG'

export class GmailError extends Error {
  constructor(
    readonly kind: GmailErrorKind,
    message: string,
    readonly status: number | null = null,
  ) {
    super(message)
    this.name = 'GmailError'
  }
}
```

`src/lib/gmail/types.ts`:

```ts
/** Bentuk respons Gmail API v1 yang benar-benar dibaca repo ini -- bukan skema lengkapnya. */
export interface GmailHeader {
  name: string
  value: string
}

export interface GmailMessagePart {
  partId?: string
  mimeType?: string
  filename?: string
  headers?: GmailHeader[]
  body?: { size?: number; data?: string; attachmentId?: string }
  parts?: GmailMessagePart[]
}

export interface GmailMessage {
  id: string
  threadId: string
  labelIds?: string[]
  /** Epoch milidetik, dalam string. */
  internalDate?: string
  payload?: GmailMessagePart
}

export interface GmailHistoryPage {
  history?: Array<{ messagesAdded?: Array<{ message: { id: string; threadId: string; labelIds?: string[] } }> }>
  nextPageToken?: string
  historyId?: string
}
```

`src/lib/gmail/oauth.ts`:

```ts
import { GmailError } from './errors'

/**
 * OAuth Google untuk kotak surat JVTO.
 *
 * readonly + send, tidak lebih. `gmail.modify` tidak diminta: wa-inbox tidak pernah menandai
 * dibaca, memindah, atau menghapus apa pun di Gmail -- Gmail tetap milik manusia yang
 * membukanya, wa-inbox hanya membaca dan membalas.
 */
export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
] as const

/** Cookie penyimpan `state` antara /oauth/start dan /oauth/callback. */
export const MAIL_OAUTH_STATE_COOKIE = 'mail_oauth_state'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'

interface TokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  error?: string
}

function oauthConfig(): { clientId: string; clientSecret: string; redirectUri: string } {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET
  const base = process.env.APP_BASE_URL
  if (!clientId || !clientSecret || !base) {
    throw new GmailError('CONFIG', 'Google OAuth belum dikonfigurasi (GOOGLE_OAUTH_CLIENT_ID/SECRET, APP_BASE_URL)')
  }
  return { clientId, clientSecret, redirectUri: `${base.replace(/\/+$/, '')}/api/mail-accounts/oauth/callback` }
}

export function buildGoogleAuthUrl(state: string): string {
  const { clientId, redirectUri } = oauthConfig()
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GMAIL_SCOPES.join(' '),
    access_type: 'offline',
    // Tanpa ini, menyambung ulang kotak surat yang pernah disambungkan TIDAK mengembalikan
    // refresh_token -- token yang dicabut jadi tidak pernah bisa diganti dari UI.
    prompt: 'consent',
    state,
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

async function postToken(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  })
  const json = (await res.json().catch(() => ({}))) as TokenResponse
  if (!res.ok) {
    if (json.error === 'invalid_grant') {
      throw new GmailError('AUTH_REVOKED', 'Google menolak refresh token (invalid_grant)', res.status)
    }
    throw new GmailError('HTTP', `Endpoint token Google ${res.status} ${json.error ?? ''}`.trim(), res.status)
  }
  return json
}

export async function exchangeAuthCode(code: string): Promise<{ accessToken: string; refreshToken: string | null; grantedScopes: string[] }> {
  const { clientId, clientSecret, redirectUri } = oauthConfig()
  const json = await postToken({
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
  })
  if (!json.access_token) throw new GmailError('HTTP', 'Endpoint token Google tidak mengembalikan access_token')
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    grantedScopes: (json.scope ?? '').split(' ').filter(Boolean),
  }
}

export async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresInSec: number }> {
  const { clientId, clientSecret } = oauthConfig()
  const json = await postToken({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  })
  if (!json.access_token) throw new GmailError('HTTP', 'Endpoint token Google tidak mengembalikan access_token')
  return { accessToken: json.access_token, expiresInSec: json.expires_in ?? 3600 }
}
```

`src/lib/gmail/client.ts`:

```ts
import { GmailError } from './errors'
import { refreshAccessToken } from './oauth'
import type { GmailHistoryPage, GmailMessage } from './types'

/**
 * Klien Gmail API v1, fetch langsung -- pola yang sama dengan modul Meta (src/lib/meta/*).
 * Tidak ada SDK: permukaan yang dipakai hanya tujuh endpoint, dan fetch yang di-mock lebih
 * jujur diuji daripada SDK yang di-mock.
 */
const API = 'https://gmail.googleapis.com/gmail/v1/users/me'

/** Access token Google berumur ~1 jam. Satu per kotak surat, di memori proses ini saja. */
const tokenCache = new Map<string, { token: string; expiresAt: number }>()

export async function getAccessToken(account: { id: string; refreshToken: string }, nowMs: number = Date.now()): Promise<string> {
  const cached = tokenCache.get(account.id)
  if (cached && cached.expiresAt - 60_000 > nowMs) return cached.token
  const fresh = await refreshAccessToken(account.refreshToken)
  tokenCache.set(account.id, { token: fresh.accessToken, expiresAt: nowMs + fresh.expiresInSec * 1000 })
  return fresh.accessToken
}

export function invalidateAccessToken(accountId: string): void {
  tokenCache.delete(accountId)
}

export function __resetTokenCacheForTests(): void {
  tokenCache.clear()
}

async function errorFrom(res: Response): Promise<GmailError> {
  const json = (await res.json().catch(() => ({}))) as { error?: { status?: string } }
  const googleStatus = json.error?.status ?? ''
  const message = `Gmail API ${res.status} ${googleStatus}`.trim()
  if (res.status === 401) return new GmailError('UNAUTHORIZED', message, res.status)
  if (res.status === 404) return new GmailError('NOT_FOUND', message, res.status)
  return new GmailError('HTTP', message, res.status)
}

async function gmailFetch<T>(token: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  if (!res.ok) throw await errorFrom(res)
  return (await res.json()) as T
}

export function gmailGetProfile(token: string): Promise<{ emailAddress: string; historyId: string }> {
  return gmailFetch(token, '/profile')
}

/**
 * Pasang atau perpanjang push. Nama field filter label diverifikasi terhadap dokumentasi
 * users.watch saat Tugas 2 (lihat rencananya) -- kalau Google mengubahnya, test ikut berubah.
 */
export function gmailWatch(token: string, topicName: string): Promise<{ historyId: string; expiration: string }> {
  return gmailFetch(token, '/watch', { topicName, labelIds: ['INBOX', 'SENT'], labelFilterBehavior: 'INCLUDE' })
}

export async function gmailListHistory(token: string, startHistoryId: string, pageToken?: string): Promise<GmailHistoryPage> {
  const params = new URLSearchParams({ startHistoryId, historyTypes: 'messageAdded' })
  if (pageToken) params.set('pageToken', pageToken)
  try {
    return await gmailFetch<GmailHistoryPage>(token, `/history?${params.toString()}`)
  } catch (error) {
    // Gmail menjawab 404 kalau startHistoryId sudah terlalu tua untuk disimpannya. Itu bukan
    // "tidak ditemukan" biasa -- pemanggil harus memulihkan kursor (src/lib/gmail/sync.ts).
    if (error instanceof GmailError && error.kind === 'NOT_FOUND') {
      throw new GmailError('HISTORY_EXPIRED', 'Kursor history Gmail kedaluwarsa', 404)
    }
    throw error
  }
}

export async function gmailListMessageIds(token: string, query: string): Promise<string[]> {
  const ids: string[] = []
  let pageToken: string | undefined
  do {
    const params = new URLSearchParams({ q: query })
    if (pageToken) params.set('pageToken', pageToken)
    const page = await gmailFetch<{ messages?: Array<{ id: string }>; nextPageToken?: string }>(token, `/messages?${params.toString()}`)
    for (const m of page.messages ?? []) ids.push(m.id)
    pageToken = page.nextPageToken
  } while (pageToken)
  return ids
}

/** Null kalau email sudah dihapus di antara history.list dan pengambilan ini. */
export async function gmailGetMessage(token: string, id: string): Promise<GmailMessage | null> {
  try {
    return await gmailFetch<GmailMessage>(token, `/messages/${encodeURIComponent(id)}?format=full`)
  } catch (error) {
    if (error instanceof GmailError && error.kind === 'NOT_FOUND') return null
    throw error
  }
}

/** Kunci hasil SELALU huruf kecil: pengirim menulis `Message-Id` maupun `Message-ID`. */
export async function gmailGetMessageHeaders(token: string, id: string, names: string[]): Promise<Record<string, string>> {
  const params = new URLSearchParams({ format: 'metadata' })
  for (const name of names) params.append('metadataHeaders', name)
  const message = await gmailFetch<GmailMessage>(token, `/messages/${encodeURIComponent(id)}?${params.toString()}`)
  const result: Record<string, string> = {}
  for (const h of message.payload?.headers ?? []) result[h.name.toLowerCase()] = h.value
  return result
}

export function gmailSendRaw(token: string, raw: string, threadId: string): Promise<{ id: string; threadId: string }> {
  return gmailFetch(token, '/messages/send', { raw, threadId })
}
```

- [ ] **Step 4: Verifikasi field watch terhadap dokumentasi**

Buka `https://developers.google.com/workspace/gmail/api/reference/rest/v1/users/watch`. Pastikan nama field filter label dan nilai enumnya. Kalau berbeda dari `labelFilterBehavior: 'INCLUDE'`, ubah `gmailWatch` **dan** harapan di test `watch mengirim topik ...` supaya cocok dengan dokumentasi. Catat hasilnya di pesan commit.

- [ ] **Step 5: Jalankan test, pastikan LULUS**

Run: `npx vitest run src/lib/gmail`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/gmail
git commit -m "feat(email): klien Gmail API dan OAuth tanpa SDK"
```

---

## Task 3: Parser MIME

**Files:**
- Create: `src/lib/gmail/parse.ts`
- Test: `src/lib/gmail/parse.test.ts`

**Interfaces:**
- Consumes: `GmailMessage`, `GmailMessagePart`, `GmailHeader` dari `./types`.
- Produces: `interface ParsedEmail { id: string; threadId: string; labelIds: string[]; sentAt: Date; from: EmailAddress | null; subject: string | null; waInboxId: string | null; body: string; attachments: string[] }`, `interface EmailAddress { address: string; name: string | null }`, `parseGmailMessage(message: GmailMessage): ParsedEmail`, `decodeMimeWords(value: string): string`, `parseAddress(value: string): EmailAddress | null`, `htmlToText(html: string): string`, `WA_INBOX_ID_HEADER = 'X-WA-Inbox-Id'`.

- [ ] **Step 1: Tulis test yang gagal**

`src/lib/gmail/parse.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseGmailMessage, decodeMimeWords, parseAddress, htmlToText } from './parse'
import type { GmailMessage, GmailMessagePart } from './types'

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url')

function message(payload: GmailMessagePart, extra: Partial<GmailMessage> = {}): GmailMessage {
  return { id: 'gm_1', threadId: 'th_1', labelIds: ['INBOX'], internalDate: '1759000000000', payload, ...extra }
}

describe('decodeMimeWords', () => {
  it('mendekode encoded-word B dan Q, termasuk dua kata bersebelahan', () => {
    expect(decodeMimeWords('=?UTF-8?B?QnJvbW8g8J+MiyBJamVu?=')).toBe('Bromo 🌋 Ijen')
    expect(decodeMimeWords('=?ISO-8859-1?Q?Jos=E9_Garc=EDa?=')).toBe('José García')
    expect(decodeMimeWords('=?UTF-8?B?QnJvbW8=?= =?UTF-8?B?IElqZW4=?=')).toBe('Bromo Ijen')
  })

  it('membiarkan teks biasa apa adanya (idempoten)', () => {
    expect(decodeMimeWords('Tour Bromo 3D2N')).toBe('Tour Bromo 3D2N')
  })
})

describe('parseAddress', () => {
  it('memisah nama dan alamat, alamat jadi huruf kecil', () => {
    expect(parseAddress('"Sinta W." <Sinta@Example.COM>')).toEqual({ address: 'sinta@example.com', name: 'Sinta W.' })
    expect(parseAddress('sinta@example.com')).toEqual({ address: 'sinta@example.com', name: null })
  })

  it('nama ber-encoded-word ikut didekode', () => {
    expect(parseAddress('=?UTF-8?B?Sm9zw6k=?= <jose@example.com>')).toEqual({ address: 'jose@example.com', name: 'José' })
  })

  it('null kalau tidak ada alamat yang bisa dibalas', () => {
    expect(parseAddress('undisclosed-recipients:;')).toBeNull()
  })
})

describe('htmlToText', () => {
  it('membuang style/script, mengubah blok jadi baris, mendekode entitas', () => {
    const html = '<html><head><style>p{color:red}</style></head><body><p>Halo&nbsp;JVTO,</p><div>Harga &amp; jadwal?</div><br>Terima kasih</body></html>'
    expect(htmlToText(html)).toBe('Halo JVTO,\nHarga & jadwal?\n\nTerima kasih')
  })

  it('membuang kutipan gmail_quote dan blockquote', () => {
    const html = '<div>Jadi 4 orang ya</div><div class="gmail_quote"><div>On Mon, X wrote:</div><blockquote>pesan lama</blockquote></div>'
    expect(htmlToText(html)).toBe('Jadi 4 orang ya')
  })

  it('email TERUSAN tidak dibuang walau memakai gmail_quote', () => {
    const html = '<div>FYI</div><div class="gmail_quote"><div>---------- Forwarded message ---------</div><div>Booking #123 dikonfirmasi</div></div>'
    const text = htmlToText(html)
    expect(text).toContain('Forwarded message')
    expect(text).toContain('Booking #123 dikonfirmasi')
  })
})

describe('parseGmailMessage', () => {
  const headers = [
    { name: 'From', value: 'Sinta <sinta@example.com>' },
    { name: 'Subject', value: '=?UTF-8?B?VHVyIEJyb21vIPCfjIs=?=' },
  ]

  it('memilih text/plain dalam multipart/alternative', () => {
    const parsed = parseGmailMessage(message({
      mimeType: 'multipart/alternative', headers,
      parts: [
        { mimeType: 'text/plain', body: { data: b64('Halo, masih ada slot?') } },
        { mimeType: 'text/html', body: { data: b64('<p>Halo, masih ada slot?</p>') } },
      ],
    }))
    expect(parsed.body).toBe('Halo, masih ada slot?')
    expect(parsed.subject).toBe('Tur Bromo 🌋')
    expect(parsed.from).toEqual({ address: 'sinta@example.com', name: 'Sinta' })
    expect(parsed.sentAt.toISOString()).toBe(new Date(1759000000000).toISOString())
  })

  it('email hanya-HTML (tanpa text/plain) jadi teks terbaca', () => {
    const parsed = parseGmailMessage(message({
      mimeType: 'text/html', headers,
      body: { data: b64('<table><tr><td>Booking</td></tr><tr><td>Bromo 12 Okt</td></tr></table><style>.x{}</style>') },
    }))
    expect(parsed.body).toBe('Booking\nBromo 12 Okt')
    expect(parsed.body).not.toMatch(/[<>{}]/)
  })

  it('text/plain kosong jatuh ke HTML', () => {
    const parsed = parseGmailMessage(message({
      mimeType: 'multipart/alternative', headers,
      parts: [
        { mimeType: 'text/plain', body: { data: b64('   ') } },
        { mimeType: 'text/html', body: { data: b64('<p>Isi sebenarnya</p>') } },
      ],
    }))
    expect(parsed.body).toBe('Isi sebenarnya')
  })

  it('mencatat nama lampiran tanpa membaca isinya', () => {
    const parsed = parseGmailMessage(message({
      mimeType: 'multipart/mixed', headers,
      parts: [
        { mimeType: 'text/plain', body: { data: b64('Paspor terlampir') } },
        { mimeType: 'application/pdf', filename: 'paspor.pdf', body: { attachmentId: 'att_1', size: 12000 } },
      ],
    }))
    expect(parsed.attachments).toEqual(['paspor.pdf'])
    expect(parsed.body).toBe('Paspor terlampir')
  })

  it('menghormati charset part selain UTF-8', () => {
    const latin1 = Buffer.from('Café à Bromo', 'latin1').toString('base64url')
    const parsed = parseGmailMessage(message({
      mimeType: 'text/plain', headers: [...headers],
      body: { data: latin1 },
      // charset dibaca dari header Content-Type part itu sendiri
    }, {}))
    expect(parsed.body).not.toBe('Café à Bromo') // tanpa header charset: dibaca sebagai UTF-8
    const withCharset = parseGmailMessage(message({
      mimeType: 'text/plain',
      headers: [...headers, { name: 'Content-Type', value: 'text/plain; charset="ISO-8859-1"' }],
      body: { data: latin1 },
    }))
    expect(withCharset.body).toBe('Café à Bromo')
  })

  it('membaca X-WA-Inbox-Id tanpa peka huruf', () => {
    const parsed = parseGmailMessage(message({
      mimeType: 'text/plain', headers: [...headers, { name: 'x-wa-inbox-id', value: 'msg_abc' }],
      body: { data: b64('x') },
    }))
    expect(parsed.waInboxId).toBe('msg_abc')
  })
})
```

- [ ] **Step 2: Jalankan, pastikan GAGAL**

Run: `npx vitest run src/lib/gmail/parse.test.ts`
Expected: FAIL — modul belum ada.

- [ ] **Step 3: Implementasi**

`src/lib/gmail/parse.ts`:

```ts
import type { GmailHeader, GmailMessage, GmailMessagePart } from './types'

/**
 * Pohon MIME Gmail -> satu email yang bisa ditulis ke Message.
 *
 * Isi yang dihasilkan di sini masih MENTAH (belum dibuang kutipannya). Pembersihan ada di
 * clean-body.ts -- kecuali kutipan versi HTML, yang harus dibuang di sini, SEBELUM tag
 * diratakan: setelah jadi teks, `<blockquote>` sudah tidak bisa dibedakan dari isi biasa.
 */

/** Header penanda email yang dikirim wa-inbox sendiri (src/lib/gmail/mime.ts). */
export const WA_INBOX_ID_HEADER = 'X-WA-Inbox-Id'

export interface EmailAddress {
  address: string
  name: string | null
}

export interface ParsedEmail {
  id: string
  threadId: string
  labelIds: string[]
  sentAt: Date
  from: EmailAddress | null
  subject: string | null
  waInboxId: string | null
  body: string
  attachments: string[]
}

function decodeBytes(bytes: Buffer, charset: string): string {
  try {
    return new TextDecoder(charset.trim().toLowerCase()).decode(bytes)
  } catch {
    // Charset yang tidak dikenal TextDecoder: UTF-8 lebih baik daripada membuang isinya.
    return bytes.toString('utf8')
  }
}

/**
 * RFC 2047. Idempoten: teks yang sudah terdekode tidak mengandung pola `=?...?=`, jadi aman
 * dipanggil walau Gmail API ternyata sudah mendekode headernya lebih dulu.
 */
export function decodeMimeWords(value: string): string {
  return value
    // Spasi DI ANTARA dua encoded-word dibuang (RFC 2047 §6.2), bukan bagian dari teks.
    .replace(/\?=\s+=\?/g, '?==?')
    .replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_whole, charset: string, encoding: string, text: string) => {
      const bytes = encoding.toUpperCase() === 'B'
        ? Buffer.from(text, 'base64')
        : Buffer.from(
            text.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16))),
            'latin1',
          )
      return decodeBytes(bytes, charset)
    })
}

export function parseAddress(value: string): EmailAddress | null {
  const decoded = decodeMimeWords(value).trim()
  const angled = decoded.match(/^(.*?)<([^<>\s]+@[^<>\s]+)>\s*$/)
  if (angled) {
    const name = angled[1].trim().replace(/^"(.*)"$/, '$1').trim()
    return { address: angled[2].toLowerCase(), name: name || null }
  }
  return /^[^\s<>@]+@[^\s<>@]+$/.test(decoded) ? { address: decoded.toLowerCase(), name: null } : null
}

function decodeEntities(text: string): string {
  const named: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code.startsWith('#')) {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole
    }
    return named[code.toLowerCase()] ?? whole
  })
}

const FORWARD_MARKER = /Forwarded message|Pesan yang diteruskan|Pesan terusan/i

export function htmlToText(html: string): string {
  let source = html.replace(/<(style|script|head)\b[\s\S]*?<\/\1>/gi, '')
  // Email TERUSAN memakai wadah gmail_quote yang sama dengan kutipan balasan, padahal isinya
  // justru pokok emailnya. Membuangnya berarti operator melihat "FYI" tanpa apa pun di bawahnya.
  if (!FORWARD_MARKER.test(source)) {
    source = source
      .replace(/<div[^>]*class="[^"]*gmail_quote[^"]*"[\s\S]*$/i, '')
      .replace(/<blockquote\b[\s\S]*?<\/blockquote>/gi, '')
  }
  const flattened = source
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
  return decodeEntities(flattened)
    .replace(/\r/g, '')
    .replace(/ /g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function header(headers: GmailHeader[] | undefined, name: string): string | null {
  const lower = name.toLowerCase()
  return headers?.find((h) => h.name.toLowerCase() === lower)?.value ?? null
}

function charsetOf(part: GmailMessagePart): string {
  return header(part.headers, 'Content-Type')?.match(/charset="?([^";\s]+)"?/i)?.[1] ?? 'utf-8'
}

interface BodyAccumulator {
  plain: string | null
  html: string | null
  attachments: string[]
}

function walk(part: GmailMessagePart, acc: BodyAccumulator): void {
  if (part.filename) {
    acc.attachments.push(part.filename)
    return
  }
  const data = part.body?.data
  if (data && part.mimeType === 'text/plain' && acc.plain === null) {
    const text = decodeBytes(Buffer.from(data, 'base64url'), charsetOf(part))
    if (text.trim()) acc.plain = text
  } else if (data && part.mimeType === 'text/html' && acc.html === null) {
    acc.html = decodeBytes(Buffer.from(data, 'base64url'), charsetOf(part))
  }
  for (const child of part.parts ?? []) walk(child, acc)
}

export function parseGmailMessage(message: GmailMessage): ParsedEmail {
  const headers = message.payload?.headers
  const acc: BodyAccumulator = { plain: null, html: null, attachments: [] }
  if (message.payload) walk(message.payload, acc)

  const fromHeader = header(headers, 'From')
  const subject = header(headers, 'Subject')

  return {
    id: message.id,
    threadId: message.threadId,
    labelIds: message.labelIds ?? [],
    sentAt: new Date(Number(message.internalDate ?? Date.now())),
    from: fromHeader ? parseAddress(fromHeader) : null,
    subject: subject ? decodeMimeWords(subject).trim() || null : null,
    waInboxId: header(headers, WA_INBOX_ID_HEADER),
    body: acc.plain ?? (acc.html ? htmlToText(acc.html) : ''),
    attachments: acc.attachments,
  }
}
```

- [ ] **Step 4: Jalankan test, pastikan LULUS**

Run: `npx vitest run src/lib/gmail/parse.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/gmail/parse.ts src/lib/gmail/parse.test.ts
git commit -m "feat(email): parser MIME Gmail (header RFC 2047, HTML ke teks, lampiran)"
```

---

## Task 4: Pembersih kutipan, signature, dan footer

**Files:**
- Create: `src/lib/gmail/clean-body.ts`
- Test: `src/lib/gmail/clean-body.test.ts`

**Interfaces:**
- Produces: `cleanEmailBody(raw: string): string`, `MAX_EMAIL_CONTENT_CHARS = 20_000`.

Spec §6.3: *"Tanpa itu, draf yang dibuat dari email keempat dalam satu benang akan menjawab pertanyaan dari email pertama."*

- [ ] **Step 1: Tulis test yang gagal**

`src/lib/gmail/clean-body.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { cleanEmailBody, MAX_EMAIL_CONTENT_CHARS } from './clean-body'

describe('cleanEmailBody', () => {
  it('memotong di "On ... wrote:" (Gmail/Apple Mail)', () => {
    const raw = 'Jadi 4 orang ya.\n\nOn Mon, 22 Sep 2026 at 10:00, JVTO <hello@javavolcano-touroperator.com> wrote:\n> Berapa orang?\n> Terima kasih'
    expect(cleanEmailBody(raw)).toBe('Jadi 4 orang ya.')
  })

  it('memotong "On ... wrote:" yang terbungkus dua baris', () => {
    const raw = 'Oke setuju.\n\nOn Mon, 22 Sep 2026 at 10:00 Java Volcano Tour Operator <\nhello@javavolcano-touroperator.com> wrote:\n> lama'
    expect(cleanEmailBody(raw)).toBe('Oke setuju.')
  })

  it('memotong "Pada ... menulis:" (Gmail berbahasa Indonesia)', () => {
    const raw = 'Siap, transfer hari ini.\n\nPada Sen, 22 Sep 2026 pukul 10.00 JVTO <hello@x.com> menulis:\n> Total Rp 5.000.000'
    expect(cleanEmailBody(raw)).toBe('Siap, transfer hari ini.')
  })

  it('memotong blok Outlook "From: / Sent:"', () => {
    const raw = 'Please confirm pickup time.\n\nFrom: JVTO <hello@x.com>\nSent: Monday, September 22, 2026 10:00 AM\nTo: John\nSubject: Re: Bromo\n\nOld text'
    expect(cleanEmailBody(raw)).toBe('Please confirm pickup time.')
  })

  it('memotong "-----Original Message-----"', () => {
    expect(cleanEmailBody('Yes.\n-----Original Message-----\nold')).toBe('Yes.')
  })

  it('membuang baris kutipan ">" yang terselip di tengah (inline reply)', () => {
    const raw = '> Berapa orang?\n4 orang\n> Tanggal?\n12 Oktober'
    expect(cleanEmailBody(raw)).toBe('4 orang\n12 Oktober')
  })

  it('memotong signature "-- " dan footer ponsel', () => {
    expect(cleanEmailBody('Oke.\n-- \nJohn Doe\nCEO Acme')).toBe('Oke.')
    expect(cleanEmailBody('Oke.\n\nSent from my iPhone')).toBe('Oke.')
    expect(cleanEmailBody('Oke.\n\nDikirim dari Yahoo Mail di Android')).toBe('Oke.')
  })

  it('email TERUSAN dipertahankan utuh, termasuk blok From:/Date: di dalamnya', () => {
    const raw = 'FYI\n\n---------- Forwarded message ---------\nFrom: Klook <noreply@klook.com>\nDate: Mon, 22 Sep 2026\nSubject: Booking\n\nBooking #123 dikonfirmasi'
    const cleaned = cleanEmailBody(raw)
    expect(cleaned).toContain('Booking #123 dikonfirmasi')
    expect(cleaned).toContain('From: Klook')
  })

  it('email yang SELURUHNYA kutipan tidak jadi kosong -- teks asli dipertahankan', () => {
    const raw = 'On Mon, X wrote:\n> hanya kutipan'
    expect(cleanEmailBody(raw)).toBe(raw)
  })

  it('email berlapis empat: hanya balasan terbaru yang tersisa', () => {
    const raw = [
      'Balasan keempat: jadi berangkat tanggal 12.',
      '',
      'On Thu, JVTO wrote:',
      '> Balasan ketiga',
      '> On Wed, Tamu wrote:',
      '>> Balasan kedua',
      '>>> Email pertama: berapa harga Bromo?',
    ].join('\n')
    expect(cleanEmailBody(raw)).toBe('Balasan keempat: jadi berangkat tanggal 12.')
  })

  it('isi yang sangat panjang dipotong dengan penanda', () => {
    const cleaned = cleanEmailBody('a'.repeat(MAX_EMAIL_CONTENT_CHARS + 500))
    expect(cleaned.length).toBeLessThan(MAX_EMAIL_CONTENT_CHARS + 100)
    expect(cleaned).toContain('[dipotong')
  })

  it('CRLF dinormalkan', () => {
    expect(cleanEmailBody('Halo\r\nJVTO\r\n')).toBe('Halo\nJVTO')
  })
})
```

- [ ] **Step 2: Jalankan, pastikan GAGAL**

Run: `npx vitest run src/lib/gmail/clean-body.test.ts`
Expected: FAIL — modul belum ada.

- [ ] **Step 3: Implementasi**

`src/lib/gmail/clean-body.ts`:

```ts
/**
 * Buang riwayat terkutip, signature, dan footer ponsel sebelum isi email ditulis ke
 * Message.content (spec §6.3). Tanpa ini, draf yang dibuat dari email keempat dalam satu
 * benang menjawab pertanyaan dari email pertama -- karena keempat email itu ikut terkutip.
 *
 * Dua pengaman yang sengaja dipasang:
 * - Email TERUSAN tidak pernah dipotong di dalam blok terusannya: blok "From:/Date:" di sana
 *   adalah isi, bukan kutipan balasan.
 * - Kalau pembersihan menyisakan kosong (email yang seluruhnya kutipan), teks asli dipakai.
 *   Pesan pelanggan yang menghilang lebih buruk daripada pesan yang terlalu panjang.
 */
export const MAX_EMAIL_CONTENT_CHARS = 20_000

const REPLY_HEADER = [
  /^On .{1,300}wrote:\s*$/i,
  /^Pada .{1,300}menulis:\s*$/i,
  /^-{2,}\s*(Original Message|Pesan Asli)\s*-{2,}\s*$/i,
]
const OUTLOOK_FROM = /^(From|Dari):\s.+/i
const OUTLOOK_NEXT = /^(Sent|Date|Dikirim|Tanggal|To|Kepada):\s/i
const MOBILE_FOOTER = /^(Sent from my |Dikirim dari )/i
const SIGNATURE_DELIMITER = /^--\s?$/
const FORWARD_MARKER = /^-{2,}\s*(Forwarded message|Pesan yang diteruskan|Pesan terusan)\s*-{2,}\s*$/i

function isReplyHeader(line: string): boolean {
  return REPLY_HEADER.some((re) => re.test(line))
}

export function cleanEmailBody(raw: string): string {
  const normalized = raw.replace(/\r\n?/g, '\n')
  const lines = normalized.split('\n')
  const kept: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    if (FORWARD_MARKER.test(trimmed)) {
      kept.push(...lines.slice(i))
      break
    }
    if (isReplyHeader(trimmed)) break
    // Gmail membungkus "On <tanggal> <nama> <alamat> wrote:" jadi dua baris kalau panjang.
    if (/^(On|Pada)\s/i.test(trimmed) && isReplyHeader(`${trimmed} ${(lines[i + 1] ?? '').trim()}`)) break
    if (OUTLOOK_FROM.test(trimmed) && lines.slice(i + 1, i + 4).some((l) => OUTLOOK_NEXT.test(l.trim()))) break
    if (SIGNATURE_DELIMITER.test(line) || MOBILE_FOOTER.test(trimmed)) break
    if (trimmed.startsWith('>')) continue
    kept.push(line)
  }

  let cleaned = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  if (!cleaned) cleaned = normalized.trim()
  if (cleaned.length > MAX_EMAIL_CONTENT_CHARS) {
    cleaned = `${cleaned.slice(0, MAX_EMAIL_CONTENT_CHARS)}\n…[dipotong — buka di Gmail untuk isi lengkap]`
  }
  return cleaned
}
```

- [ ] **Step 4: Jalankan test, pastikan LULUS**

Run: `npx vitest run src/lib/gmail/clean-body.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/gmail/clean-body.ts src/lib/gmail/clean-body.test.ts
git commit -m "feat(email): pembersih kutipan, signature, dan footer email"
```

---

## Task 5: Ingest satu email

**Files:**
- Create: `src/lib/gmail/ingest.ts`
- Test: `src/lib/gmail/ingest.test.ts`

**Interfaces:**
- Consumes: `parseGmailMessage`, `ParsedEmail` (Tugas 3); `cleanEmailBody` (Tugas 4); `upsertChannelIdentity` (`@/lib/channel/identity`); `broadcast` (`@/lib/realtime`); `withMediaUrl` (`@/lib/serialize-message`).
- Produces: `type IngestOutcome = 'created' | 'reconciled' | 'skipped'`, `ingestGmailMessage(account: { id: string; emailAddress: string }, message: GmailMessage): Promise<IngestOutcome>`.

Aturan (urutannya penting):
1. Label `SPAM`/`TRASH`/`DRAFT`/`CHAT` → `skipped` (D2).
2. `Message.externalId` = id Gmail sudah ada → `skipped`.
3. Berlabel `SENT` = keluar. Kalau `X-WA-Inbox-Id` menunjuk baris kita → isi `externalId`-nya bila masih kosong → `reconciled`. Kalau tidak, dan benangnya sudah ada → tulis OUTBOUND `sentBy: 'AGENT'`. Benang belum ada → `skipped` (D4).
4. Tidak berlabel `SENT` tapi `From` = alamat kotak surat itu sendiri → `skipped` (catatan untuk diri sendiri atau pemalsuan `From`; bukan pelanggan).
5. Masuk: cari benang lewat `(mailAccountId, threadId)` lebih dulu, siapa pun pengirimnya. Kalau belum ada: identitas `EMAIL` → Contact (hanya kalau identitas baru) → Conversation `botEnabled: false`.

`X-WA-Inbox-Id` hanya dipercaya pada email berlabel `SENT`. Header itu bisa dipalsukan siapa saja di email masuk, sedangkan label `SENT` dipasang Gmail sendiri.

- [ ] **Step 1: Tulis test yang gagal**

`src/lib/gmail/ingest.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import { Prisma, type PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { upsertChannelIdentity } from '@/lib/channel/identity'
import { broadcast } from '@/lib/realtime'
import type { GmailMessage } from './types'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/channel/identity', () => ({ upsertChannelIdentity: vi.fn() }))
vi.mock('@/lib/realtime', () => ({ broadcast: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>
import { ingestGmailMessage } from './ingest'

const account = { id: 'mail_1', emailAddress: 'hello@javavolcano-touroperator.com' }
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url')

function email(overrides: { labelIds?: string[]; from?: string; body?: string; headers?: Array<{ name: string; value: string }> } = {}): GmailMessage {
  return {
    id: 'gm_1',
    threadId: 'th_1',
    labelIds: overrides.labelIds ?? ['INBOX', 'UNREAD'],
    internalDate: '1759000000000',
    payload: {
      mimeType: 'text/plain',
      headers: [
        { name: 'From', value: overrides.from ?? 'Sinta <sinta@example.com>' },
        { name: 'Subject', value: 'Tur Bromo' },
        ...(overrides.headers ?? []),
      ],
      body: { data: b64(overrides.body ?? 'Masih ada slot 12 Okt?\n\nOn Mon, JVTO wrote:\n> lama') },
    },
  }
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.mocked(broadcast).mockReset()
  vi.mocked(upsertChannelIdentity).mockReset().mockResolvedValue({ id: 'ci_1', contactId: 'contact_1' })
  mockPrisma.message.findUnique.mockResolvedValue(null as never)
  mockPrisma.conversation.findFirst.mockResolvedValue(null as never)
  mockPrisma.channelIdentity.findUnique.mockResolvedValue(null as never)
  mockPrisma.contact.create.mockResolvedValue({ id: 'contact_1' } as never)
  mockPrisma.conversation.upsert.mockResolvedValue({ id: 'conv_1' } as never)
  mockPrisma.message.create.mockResolvedValue({ id: 'msg_1', conversationId: 'conv_1' } as never)
  mockPrisma.conversation.updateMany.mockResolvedValue({ count: 1 } as never)
})

describe('ingestGmailMessage — masuk', () => {
  it('email baru melahirkan identitas EMAIL, benang ber-threadId, dan pesan yang sudah dibersihkan', async () => {
    expect(await ingestGmailMessage(account, email())).toBe('created')

    expect(upsertChannelIdentity).toHaveBeenCalledWith(expect.objectContaining({
      platform: 'EMAIL', externalId: 'sinta@example.com', contactId: 'contact_1', displayName: 'Sinta',
    }))
    const upsert = mockPrisma.conversation.upsert.mock.calls[0][0]
    expect(upsert.where).toEqual({ channelIdentityId_externalThreadId: { channelIdentityId: 'ci_1', externalThreadId: 'th_1' } })
    expect(upsert.create).toMatchObject({ mailAccountId: 'mail_1', subject: 'Tur Bromo', externalThreadId: 'th_1' })

    const created = mockPrisma.message.create.mock.calls[0][0].data
    expect(created).toMatchObject({ externalId: 'gm_1', direction: 'INBOUND', sentBy: 'CUSTOMER', channel: 'OFFICIAL' })
    expect(created.content).toBe('Masih ada slot 12 Okt?')
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ type: 'message.created', conversationId: 'conv_1' }))
  })

  it('bot TIDAK PERNAH menyala untuk percakapan email (draf manual saja)', async () => {
    await ingestGmailMessage(account, email())
    expect(mockPrisma.conversation.upsert.mock.calls[0][0].create).toMatchObject({ botEnabled: false })
    // Dan tidak membaca Settings sama sekali: tidak ada sakelar yang bisa menyalakannya.
    expect(mockPrisma.settings.findUniqueOrThrow).not.toHaveBeenCalled()
  })

  it('pengirim lain di thread yang sama masuk ke benang yang SAMA', async () => {
    mockPrisma.conversation.findFirst.mockResolvedValue({ id: 'conv_existing' } as never)
    await ingestGmailMessage(account, email({ from: 'Budi <budi@example.com>' }))
    expect(mockPrisma.conversation.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { mailAccountId: 'mail_1', externalThreadId: 'th_1' },
    }))
    expect(mockPrisma.conversation.upsert).not.toHaveBeenCalled()
    expect(mockPrisma.message.create.mock.calls[0][0].data.conversationId).toBe('conv_existing')
  })

  it('identitas lama dipakai ulang -- tidak membuat Contact yatim', async () => {
    mockPrisma.channelIdentity.findUnique.mockResolvedValue({ contactId: 'contact_lama' } as never)
    await ingestGmailMessage(account, email())
    expect(mockPrisma.contact.create).not.toHaveBeenCalled()
  })

  it('lampiran dicatat sebagai baris penanda', async () => {
    const msg = email()
    msg.payload = {
      mimeType: 'multipart/mixed',
      headers: msg.payload?.headers,
      parts: [
        { mimeType: 'text/plain', body: { data: b64('Paspor terlampir') } },
        { mimeType: 'application/pdf', filename: 'paspor.pdf', body: { attachmentId: 'a1' } },
      ],
    }
    await ingestGmailMessage(account, msg)
    expect(mockPrisma.message.create.mock.calls[0][0].data.content).toBe('Paspor terlampir\n\n[Lampiran: paspor.pdf]')
  })

  it.each(['SPAM', 'TRASH', 'DRAFT', 'CHAT'])('label %s dilewati', async (label) => {
    expect(await ingestGmailMessage(account, email({ labelIds: [label] }))).toBe('skipped')
    expect(mockPrisma.message.create).not.toHaveBeenCalled()
  })

  it('kategori Promosi TETAP masuk (label, bukan gerbang)', async () => {
    expect(await ingestGmailMessage(account, email({ labelIds: ['INBOX', 'CATEGORY_PROMOTIONS'] }))).toBe('created')
  })

  it('email yang sudah tercatat dilewati', async () => {
    mockPrisma.message.findUnique.mockResolvedValue({ id: 'msg_lama' } as never)
    expect(await ingestGmailMessage(account, email())).toBe('skipped')
  })

  it('balapan push vs cron: P2002 pada externalId dilaporkan skipped, tidak melempar', async () => {
    mockPrisma.message.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }),
    )
    expect(await ingestGmailMessage(account, email())).toBe('skipped')
    expect(broadcast).not.toHaveBeenCalled()
  })

  it('email masuk ber-From alamat kotak surat sendiri (tanpa label SENT) dilewati', async () => {
    expect(await ingestGmailMessage(account, email({ from: 'JVTO <hello@javavolcano-touroperator.com>' }))).toBe('skipped')
  })

  it('X-WA-Inbox-Id pada email MASUK diabaikan (header bisa dipalsukan)', async () => {
    await ingestGmailMessage(account, email({ headers: [{ name: 'X-WA-Inbox-Id', value: 'msg_korban' }] }))
    expect(mockPrisma.message.update).not.toHaveBeenCalled()
    expect(mockPrisma.message.create).toHaveBeenCalled()
  })
})

describe('ingestGmailMessage — keluar (SENT)', () => {
  it('salinan SENT dari balasan Inbox hanya mengisi externalId baris kita, tidak menduplikasi', async () => {
    mockPrisma.message.findUnique
      .mockResolvedValueOnce(null as never) // cek externalId
      .mockResolvedValueOnce({ id: 'msg_kita', externalId: null } as never) // cek X-WA-Inbox-Id
    const sent = email({ labelIds: ['SENT'], from: 'hello@javavolcano-touroperator.com', headers: [{ name: 'X-WA-Inbox-Id', value: 'msg_kita' }] })

    expect(await ingestGmailMessage(account, sent)).toBe('reconciled')
    expect(mockPrisma.message.update).toHaveBeenCalledWith({ where: { id: 'msg_kita' }, data: { externalId: 'gm_1' } })
    expect(mockPrisma.message.create).not.toHaveBeenCalled()
  })

  it('balasan admin dari Gmail web masuk sebagai OUTBOUND di benang yang ada', async () => {
    mockPrisma.conversation.findFirst.mockResolvedValue({ id: 'conv_existing' } as never)
    const sent = email({ labelIds: ['SENT'], from: 'hello@javavolcano-touroperator.com', body: 'Slot masih ada.' })

    expect(await ingestGmailMessage(account, sent)).toBe('created')
    expect(mockPrisma.message.create.mock.calls[0][0].data).toMatchObject({
      conversationId: 'conv_existing', direction: 'OUTBOUND', sentBy: 'AGENT', deliveryStatus: 'SENT', content: 'Slot masih ada.',
    })
    expect(upsertChannelIdentity).not.toHaveBeenCalled()
  })

  it('email keluar yang membuka benang baru tidak membuat percakapan (D4)', async () => {
    const sent = email({ labelIds: ['SENT'], from: 'hello@javavolcano-touroperator.com' })
    expect(await ingestGmailMessage(account, sent)).toBe('skipped')
    expect(mockPrisma.conversation.upsert).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Jalankan, pastikan GAGAL**

Run: `npx vitest run src/lib/gmail/ingest.test.ts`
Expected: FAIL — modul belum ada.

- [ ] **Step 3: Implementasi**

`src/lib/gmail/ingest.ts`:

```ts
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { upsertChannelIdentity } from '@/lib/channel/identity'
import { broadcast } from '@/lib/realtime'
import { withMediaUrl } from '@/lib/serialize-message'
import { cleanEmailBody } from './clean-body'
import { parseGmailMessage, type EmailAddress, type ParsedEmail } from './parse'
import type { GmailMessage } from './types'

/**
 * Satu email Gmail -> satu Message di benangnya.
 *
 * TIDAK ADA jalur bot di sini, dan itu disengaja (spec §2, §11): bot di email hanya membuat
 * draf yang ditekan operator (src/lib/inbox/message-draft.ts). Percakapan email lahir dengan
 * botEnabled: false, tanpa membaca Settings -- tidak ada sakelar yang bisa menyalakannya.
 */
export type IngestOutcome = 'created' | 'reconciled' | 'skipped'

/**
 * Vonis GMAIL sendiri, bukan penyaring buatan kita (keputusan D2). Kategori Promosi/Sosial/
 * Update sengaja TIDAK ada di sini: semua email masuk, pelabelan urusan fase 3b.
 */
const SKIP_LABELS = new Set(['SPAM', 'TRASH', 'DRAFT', 'CHAT'])

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

function composeContent(email: ParsedEmail): string {
  const body = cleanEmailBody(email.body)
  const attachments = email.attachments.map((name) => `[Lampiran: ${name}]`).join('\n')
  return [body, attachments].filter(Boolean).join('\n\n') || '(email tanpa isi)'
}

export async function ingestGmailMessage(account: { id: string; emailAddress: string }, message: GmailMessage): Promise<IngestOutcome> {
  const email = parseGmailMessage(message)
  if (email.labelIds.some((label) => SKIP_LABELS.has(label))) return 'skipped'

  const existing = await prisma.message.findUnique({ where: { externalId: email.id }, select: { id: true } })
  if (existing) return 'skipped'

  const content = composeContent(email)

  // Label SENT dipasang Gmail sendiri; From bisa dipalsukan siapa saja. Arah pesan karena itu
  // ditentukan label, bukan header.
  if (email.labelIds.includes('SENT')) return ingestOutbound(account, email, content)

  if (!email.from) {
    console.warn('ingestGmailMessage: email tanpa alamat pengirim yang bisa dibalas', { gmailMessageId: email.id })
    return 'skipped'
  }
  // Tanpa label SENT tapi "dari" kotak surat ini sendiri: catatan untuk diri sendiri, atau
  // pemalsuan From. Bukan pelanggan -- jangan lahirkan kontak ber-alamat JVTO.
  if (email.from.address === account.emailAddress) return 'skipped'

  const conversationId = await findOrCreateThread(account, email, email.from)
  return createMessage(conversationId, email, content, 'INBOUND')
}

async function ingestOutbound(account: { id: string }, email: ParsedEmail, content: string): Promise<IngestOutcome> {
  // Salinan SENT dari balasan yang dikirim wa-inbox sendiri (src/lib/gmail/send.ts menandainya
  // dengan X-WA-Inbox-Id). Barisnya sudah ada; cukup pastikan externalId-nya terisi, karena
  // sinkronisasi bisa tiba lebih dulu daripada jawaban messages.send.
  if (email.waInboxId) {
    const own = await prisma.message.findUnique({ where: { id: email.waInboxId }, select: { id: true, externalId: true } })
    if (own) {
      if (!own.externalId) await prisma.message.update({ where: { id: own.id }, data: { externalId: email.id } })
      return 'reconciled'
    }
  }

  // Balasan yang diketik admin langsung di Gmail web. Dicatat hanya kalau benangnya sudah ada
  // di Inbox (keputusan D4) -- email yang dibuka JVTO muncul begitu pelanggan membalas.
  const conversation = await prisma.conversation.findFirst({
    where: { mailAccountId: account.id, externalThreadId: email.threadId },
    select: { id: true },
  })
  if (!conversation) return 'skipped'
  return createMessage(conversation.id, email, content, 'OUTBOUND')
}

async function findOrCreateThread(account: { id: string }, email: ParsedEmail, from: EmailAddress): Promise<string> {
  // Benang dicari lewat (kotak surat, thread Gmail) LEBIH DULU, siapa pun pengirimnya: orang
  // kedua yang ikut membalas di thread yang sama harus masuk benang yang sama.
  const byThread = await prisma.conversation.findFirst({
    where: { mailAccountId: account.id, externalThreadId: email.threadId },
    select: { id: true },
  })
  if (byThread) return byThread.id

  // Identitas dulu, Contact hanya kalau identitasnya baru -- pola yang sama dengan
  // src/lib/inbound-messenger.ts, supaya pelanggan yang menulis 50 email tidak meninggalkan
  // 49 Contact yatim.
  const known = await prisma.channelIdentity.findUnique({
    where: { platform_externalId: { platform: 'EMAIL', externalId: from.address } },
    select: { contactId: true },
  })
  const contactId = known?.contactId ?? (await prisma.contact.create({ data: { phone: null, name: from.name } })).id
  const identity = await upsertChannelIdentity({
    platform: 'EMAIL',
    externalId: from.address,
    contactId,
    displayName: from.name ?? undefined,
  })

  try {
    const conversation = await prisma.conversation.upsert({
      where: { channelIdentityId_externalThreadId: { channelIdentityId: identity.id, externalThreadId: email.threadId } },
      update: {},
      create: {
        contactId: identity.contactId,
        channelIdentityId: identity.id,
        externalThreadId: email.threadId,
        mailAccountId: account.id,
        subject: email.subject,
        lastMessageAt: email.sentAt,
        botEnabled: false,
      },
      select: { id: true },
    })
    return conversation.id
  } catch (error) {
    // Dua peserta berbeda membalas thread baru yang sama nyaris bersamaan: yang kalah menabrak
    // @@unique([mailAccountId, externalThreadId]). Benangnya sudah ada -- pakai yang menang.
    if (isUniqueViolation(error)) {
      const winner = await prisma.conversation.findFirst({
        where: { mailAccountId: account.id, externalThreadId: email.threadId },
        select: { id: true },
      })
      if (winner) return winner.id
    }
    throw error
  }
}

async function createMessage(
  conversationId: string,
  email: ParsedEmail,
  content: string,
  direction: 'INBOUND' | 'OUTBOUND',
): Promise<IngestOutcome> {
  try {
    const created = await prisma.message.create({
      data: {
        conversationId,
        externalId: email.id,
        direction,
        type: 'text',
        content,
        channel: 'OFFICIAL',
        sentBy: direction === 'INBOUND' ? 'CUSTOMER' : 'AGENT',
        ...(direction === 'OUTBOUND' ? { deliveryStatus: 'SENT' as const } : {}),
        // Waktu Gmail, bukan waktu sinkronisasi: pemulihan 7 hari (sync.ts) menarik email lama,
        // dan email lama yang tercatat "baru saja" merusak urutan benangnya.
        createdAt: email.sentAt,
      },
    })
    // Hanya MAJU: email lama dari pemulihan tidak boleh memundurkan urutan sidebar.
    await prisma.conversation.updateMany({
      where: { id: conversationId, lastMessageAt: { lt: email.sentAt } },
      data: { lastMessageAt: email.sentAt },
    })
    broadcast({ type: 'message.created', conversationId, message: withMediaUrl(created) })
    return 'created'
  } catch (error) {
    // Push dan cron memproses email yang sama bersamaan; @unique externalId menahan duplikat.
    if (isUniqueViolation(error)) return 'skipped'
    throw error
  }
}
```

Catatan untuk pelaksana: kalau `tsc` menolak `displayName: from.name ?? undefined` karena tipe input `upsertChannelIdentity`, buka `src/lib/channel/identity.ts` dan pakai bentuk yang diterimanya. Pertahankan maksudnya: **jangan pernah mengirim `null` eksplisit** (kepala file itu menjelaskan bahwa `null` menghapus nama yang sudah tersimpan).

- [ ] **Step 4: Jalankan test, pastikan LULUS**

Run: `npx vitest run src/lib/gmail/ingest.test.ts && npx tsc --noEmit`
Expected: PASS, tsc exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/gmail/ingest.ts src/lib/gmail/ingest.test.ts
git commit -m "feat(email): ingest email Gmail ke benang Inbox tanpa jalur bot"
```

---

## Task 6: Sinkronisasi per kotak surat

**Files:**
- Create: `src/lib/gmail/sync.ts`
- Test: `src/lib/gmail/sync.test.ts`

**Interfaces:**
- Consumes: `getAccessToken`, `invalidateAccessToken`, `gmailGetProfile`, `gmailListHistory`, `gmailListMessageIds`, `gmailGetMessage`, `gmailWatch` (Tugas 2); `GmailError` (Tugas 2); `ingestGmailMessage` (Tugas 5).
- Produces: `type MailSyncError = 'AUTH_REVOKED' | 'GMAIL_HTTP' | 'INGEST_FAILED' | 'WATCH_FAILED'`, `interface SyncResult { accountId: string; emailAddress: string; ingested: number; skipped: number; error: MailSyncError | null }`, `syncMailAccount(accountId: string, now?: Date): Promise<SyncResult>`, `requestSync(accountId: string): Promise<SyncResult>`, `syncAllMailAccounts(): Promise<SyncResult[]>`, `__resetSyncStateForTests(): void`.

Perilaku:
- `historyId` null → ambil kursor dari profil, tanpa ingest.
- History 404 → ambil `historyId` profil **dulu**, lalu tarik `newer_than:7d` (D3).
- Ada email yang gagal di-ingest → kursor **tidak** dimajukan (email itu dicoba lagi berikutnya; duplikat ditahan `externalId`), `INGEST_FAILED`.
- Kursor hanya maju, dan ditulis dengan `updateMany where historyId = nilai lama` (optimistic). Dua sinkronisasi yang balapan tidak bisa saling memundurkan.
- `watch()` diperpanjang kalau sisa umurnya < 24 jam atau belum pernah dipasang. `GMAIL_PUBSUB_TOPIC` kosong = mode tarik-saja, bukan error.
- `lastSyncAt` hanya ditulis saat berhasil; `lastSyncError` selalu ditulis (null = sehat).
- `requestSync` single-flight per kotak surat. Bel yang berbunyi saat sinkronisasi sedang jalan memicu **satu** putaran ulang, bukan diabaikan: email yang tiba di tengah putaran bisa terlewat dari kursor yang sudah dibaca.

- [ ] **Step 1: Tulis test yang gagal**

`src/lib/gmail/sync.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import * as client from './client'
import { ingestGmailMessage } from './ingest'
import { GmailError } from './errors'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('./client', () => ({
  getAccessToken: vi.fn(), invalidateAccessToken: vi.fn(), gmailGetProfile: vi.fn(), gmailListHistory: vi.fn(),
  gmailListMessageIds: vi.fn(), gmailGetMessage: vi.fn(), gmailWatch: vi.fn(),
}))
vi.mock('./ingest', () => ({ ingestGmailMessage: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>
import { syncMailAccount, requestSync, syncAllMailAccounts, __resetSyncStateForTests } from './sync'

const NOW = new Date('2026-09-28T05:00:00Z')
const account = {
  id: 'mail_1', emailAddress: 'hello@javavolcano-touroperator.com', refreshToken: 'rt', historyId: '100',
  watchExpiresAt: new Date('2026-10-03T00:00:00Z'), lastSyncAt: null, lastSyncError: null, createdAt: NOW,
}

beforeEach(() => {
  mockReset(mockPrisma)
  __resetSyncStateForTests()
  vi.stubEnv('GMAIL_PUBSUB_TOPIC', 'projects/p/topics/t')
  mockPrisma.mailAccount.findUniqueOrThrow.mockResolvedValue(account as never)
  mockPrisma.mailAccount.update.mockResolvedValue(account as never)
  mockPrisma.mailAccount.updateMany.mockResolvedValue({ count: 1 } as never)
  vi.mocked(client.getAccessToken).mockReset().mockResolvedValue('at')
  vi.mocked(client.gmailListHistory).mockReset().mockResolvedValue({
    history: [{ messagesAdded: [{ message: { id: 'gm_1', threadId: 't' } }, { message: { id: 'gm_2', threadId: 't' } }] }],
    historyId: '150',
  })
  vi.mocked(client.gmailGetMessage).mockReset().mockImplementation(async (_t, id) => ({ id, threadId: 't' }))
  vi.mocked(client.gmailGetProfile).mockReset().mockResolvedValue({ emailAddress: account.emailAddress, historyId: '900' })
  vi.mocked(client.gmailListMessageIds).mockReset().mockResolvedValue(['gm_old'])
  vi.mocked(client.gmailWatch).mockReset().mockResolvedValue({ historyId: '150', expiration: String(Date.parse('2026-10-05T05:00:00Z')) })
  vi.mocked(ingestGmailMessage).mockReset().mockResolvedValue('created')
})
afterEach(() => vi.unstubAllEnvs())

describe('syncMailAccount', () => {
  it('meng-ingest setiap email baru dan memajukan kursor secara optimistic', async () => {
    const result = await syncMailAccount('mail_1', NOW)

    expect(result).toMatchObject({ ingested: 2, skipped: 0, error: null })
    expect(mockPrisma.mailAccount.updateMany).toHaveBeenCalledWith({
      where: { id: 'mail_1', historyId: '100' }, data: { historyId: '150' },
    })
    expect(mockPrisma.mailAccount.update).toHaveBeenLastCalledWith({
      where: { id: 'mail_1' }, data: { lastSyncAt: NOW, lastSyncError: null },
    })
  })

  it('email yang sama muncul di dua entri history hanya diambil sekali', async () => {
    vi.mocked(client.gmailListHistory).mockResolvedValue({
      history: [{ messagesAdded: [{ message: { id: 'gm_1', threadId: 't' } }] }, { messagesAdded: [{ message: { id: 'gm_1', threadId: 't' } }] }],
      historyId: '150',
    })
    await syncMailAccount('mail_1', NOW)
    expect(client.gmailGetMessage).toHaveBeenCalledTimes(1)
  })

  it('mengikuti nextPageToken sampai habis', async () => {
    vi.mocked(client.gmailListHistory)
      .mockResolvedValueOnce({ history: [{ messagesAdded: [{ message: { id: 'gm_1', threadId: 't' } }] }], nextPageToken: 'p2', historyId: '150' })
      .mockResolvedValueOnce({ history: [{ messagesAdded: [{ message: { id: 'gm_2', threadId: 't' } }] }], historyId: '160' })
    const result = await syncMailAccount('mail_1', NOW)
    expect(result.ingested).toBe(2)
    expect(mockPrisma.mailAccount.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { historyId: '160' } }))
  })

  it('kursor kedaluwarsa: ambil kursor profil DULU, lalu pulihkan 7 hari terakhir', async () => {
    vi.mocked(client.gmailListHistory).mockRejectedValue(new GmailError('HISTORY_EXPIRED', 'x', 404))
    const result = await syncMailAccount('mail_1', NOW)

    expect(client.gmailListMessageIds).toHaveBeenCalledWith('at', 'newer_than:7d -in:spam -in:trash -in:drafts')
    const profileOrder = vi.mocked(client.gmailGetProfile).mock.invocationCallOrder[0]
    const listOrder = vi.mocked(client.gmailListMessageIds).mock.invocationCallOrder[0]
    expect(profileOrder).toBeLessThan(listOrder)
    expect(result.error).toBeNull()
    expect(mockPrisma.mailAccount.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { historyId: '900' } }))
  })

  it('historyId null: hanya pasang kursor dari profil, tidak meng-ingest apa pun', async () => {
    mockPrisma.mailAccount.findUniqueOrThrow.mockResolvedValue({ ...account, historyId: null } as never)
    await syncMailAccount('mail_1', NOW)
    expect(client.gmailListHistory).not.toHaveBeenCalled()
    expect(ingestGmailMessage).not.toHaveBeenCalled()
    expect(mockPrisma.mailAccount.updateMany).toHaveBeenCalledWith({ where: { id: 'mail_1', historyId: null }, data: { historyId: '900' } })
  })

  it('satu email gagal: sisanya tetap diproses, kursor TIDAK maju, error INGEST_FAILED, watch tetap diperpanjang', async () => {
    mockPrisma.mailAccount.findUniqueOrThrow.mockResolvedValue({ ...account, watchExpiresAt: null } as never)
    vi.mocked(ingestGmailMessage).mockRejectedValueOnce(new Error('db down')).mockResolvedValueOnce('created')
    const result = await syncMailAccount('mail_1', NOW)
    expect(result).toMatchObject({ ingested: 1, error: 'INGEST_FAILED' })
    expect(mockPrisma.mailAccount.updateMany).not.toHaveBeenCalled()
    expect(client.gmailWatch).toHaveBeenCalled()
    expect(mockPrisma.mailAccount.update).toHaveBeenLastCalledWith({ where: { id: 'mail_1' }, data: { lastSyncError: 'INGEST_FAILED' } })
  })

  it('refresh token dicabut: AUTH_REVOKED tercatat, lastSyncAt tidak ditimpa', async () => {
    vi.mocked(client.getAccessToken).mockRejectedValue(new GmailError('AUTH_REVOKED', 'invalid_grant', 400))
    const result = await syncMailAccount('mail_1', NOW)
    expect(result.error).toBe('AUTH_REVOKED')
    expect(mockPrisma.mailAccount.update).toHaveBeenLastCalledWith({ where: { id: 'mail_1' }, data: { lastSyncError: 'AUTH_REVOKED' } })
  })

  it('401 dari Gmail membuang access token dari cache', async () => {
    vi.mocked(client.gmailListHistory).mockRejectedValue(new GmailError('UNAUTHORIZED', 'x', 401))
    const result = await syncMailAccount('mail_1', NOW)
    expect(result.error).toBe('GMAIL_HTTP')
    expect(client.invalidateAccessToken).toHaveBeenCalledWith('mail_1')
  })

  it('watch diperpanjang kalau sisa umurnya kurang dari 24 jam', async () => {
    mockPrisma.mailAccount.findUniqueOrThrow.mockResolvedValue({ ...account, watchExpiresAt: new Date('2026-09-28T20:00:00Z') } as never)
    await syncMailAccount('mail_1', NOW)
    expect(client.gmailWatch).toHaveBeenCalledWith('at', 'projects/p/topics/t')
    expect(mockPrisma.mailAccount.update).toHaveBeenCalledWith({
      where: { id: 'mail_1' }, data: { watchExpiresAt: new Date('2026-10-05T05:00:00Z') },
    })
  })

  it('watch yang masih panjang umurnya tidak disentuh', async () => {
    await syncMailAccount('mail_1', NOW)
    expect(client.gmailWatch).not.toHaveBeenCalled()
  })

  it('tanpa GMAIL_PUBSUB_TOPIC: mode tarik-saja, bukan error', async () => {
    vi.stubEnv('GMAIL_PUBSUB_TOPIC', '')
    mockPrisma.mailAccount.findUniqueOrThrow.mockResolvedValue({ ...account, watchExpiresAt: null } as never)
    const result = await syncMailAccount('mail_1', NOW)
    expect(client.gmailWatch).not.toHaveBeenCalled()
    expect(result.error).toBeNull()
  })

  it('watch gagal: WATCH_FAILED, tapi email tetap tersinkron dan kursor tetap maju', async () => {
    mockPrisma.mailAccount.findUniqueOrThrow.mockResolvedValue({ ...account, watchExpiresAt: null } as never)
    vi.mocked(client.gmailWatch).mockRejectedValue(new GmailError('HTTP', 'x', 403))
    const result = await syncMailAccount('mail_1', NOW)
    expect(result).toMatchObject({ ingested: 2, error: 'WATCH_FAILED' })
    expect(mockPrisma.mailAccount.updateMany).toHaveBeenCalled()
  })
})

describe('requestSync (single-flight)', () => {
  it('bel yang berbunyi saat sinkronisasi berjalan memicu SATU putaran ulang, bukan dua', async () => {
    let release: () => void = () => {}
    vi.mocked(client.getAccessToken).mockImplementationOnce(() => new Promise((r) => { release = () => r('at') }))

    const first = requestSync('mail_1')
    const second = requestSync('mail_1')
    const third = requestSync('mail_1')
    expect(second).toBe(first)
    expect(third).toBe(first)

    // getAccessToken baru dipanggil setelah findUniqueOrThrow selesai (microtask); release()
    // sebelum itu masih no-op dan test menggantung.
    await vi.waitFor(() => expect(client.getAccessToken).toHaveBeenCalled())
    release()
    await first
    expect(mockPrisma.mailAccount.findUniqueOrThrow).toHaveBeenCalledTimes(2)
  })
})

describe('syncAllMailAccounts', () => {
  it('kegagalan satu kotak surat tidak menghentikan yang lain', async () => {
    mockPrisma.mailAccount.findMany.mockResolvedValue([{ id: 'mail_1' }, { id: 'mail_2' }] as never)
    mockPrisma.mailAccount.findUniqueOrThrow.mockImplementation((async (args: { where: { id: string } }) =>
      ({ ...account, id: args.where.id, emailAddress: `${args.where.id}@x.com` })) as never)
    vi.mocked(client.getAccessToken)
      .mockRejectedValueOnce(new GmailError('AUTH_REVOKED', 'x', 400))
      .mockResolvedValueOnce('at')

    const results = await syncAllMailAccounts()
    expect(results.map((r) => r.error)).toEqual(['AUTH_REVOKED', null])
  })
})
```

- [ ] **Step 2: Jalankan, pastikan GAGAL**

Run: `npx vitest run src/lib/gmail/sync.test.ts`
Expected: FAIL — modul belum ada.

- [ ] **Step 3: Implementasi**

`src/lib/gmail/sync.ts`:

```ts
import { prisma } from '@/lib/db'
import {
  getAccessToken, invalidateAccessToken, gmailGetMessage, gmailGetProfile,
  gmailListHistory, gmailListMessageIds, gmailWatch,
} from './client'
import { GmailError } from './errors'
import { ingestGmailMessage } from './ingest'

/**
 * Tarik email baru satu kotak surat, sejak kursor terakhir.
 *
 * Dua pemanggil, satu fungsi: bel pintu Pub/Sub (POST /api/webhooks/gmail) dan cron 15 menit
 * (POST /api/email/sync). Cron BUKAN sekadar cadangan -- ia yang memperpanjang watch(), yang
 * kedaluwarsa tiap 7 hari dan kalau gagal diperpanjang email berhenti masuk TANPA error apa
 * pun (spec §6.3). Tarikan berkala membuat watch yang telanjur mati sembuh sendiri.
 */
export type MailSyncError = 'AUTH_REVOKED' | 'GMAIL_HTTP' | 'INGEST_FAILED' | 'WATCH_FAILED'

export interface SyncResult {
  accountId: string
  emailAddress: string
  ingested: number
  skipped: number
  error: MailSyncError | null
}

/** Keputusan D3: pemulihan kursor kedaluwarsa menarik 7 hari, tidak lebih. */
const RECOVERY_QUERY = 'newer_than:7d -in:spam -in:trash -in:drafts'
const WATCH_RENEW_MARGIN_MS = 24 * 60 * 60 * 1000

async function collectNewMessageIds(token: string, historyId: string | null): Promise<{ messageIds: string[]; nextHistoryId: string }> {
  if (historyId === null) {
    const profile = await gmailGetProfile(token)
    return { messageIds: [], nextHistoryId: profile.historyId }
  }
  try {
    const ids = new Set<string>()
    let latest = historyId
    let pageToken: string | undefined
    do {
      const page = await gmailListHistory(token, historyId, pageToken)
      for (const entry of page.history ?? []) {
        for (const added of entry.messagesAdded ?? []) ids.add(added.message.id)
      }
      if (page.historyId) latest = page.historyId
      pageToken = page.nextPageToken
    } while (pageToken)
    return { messageIds: [...ids], nextHistoryId: latest }
  } catch (error) {
    if (!(error instanceof GmailError && error.kind === 'HISTORY_EXPIRED')) throw error
    // Kursor profil diambil SEBELUM daftar pemulihan: email yang tiba di antara keduanya lalu
    // tercakup dua kali (aman, externalId @unique), bukan nol kali.
    const profile = await gmailGetProfile(token)
    const messageIds = await gmailListMessageIds(token, RECOVERY_QUERY)
    return { messageIds, nextHistoryId: profile.historyId }
  }
}

/**
 * Hanya MAJU, dan hanya kalau tidak ada yang mendahului: `where historyId = nilai lama`
 * membuat dua sinkronisasi yang balapan tidak bisa saling memundurkan kursor.
 */
async function advanceHistoryId(accountId: string, current: string | null, next: string): Promise<void> {
  if (current !== null && BigInt(next) <= BigInt(current)) return
  await prisma.mailAccount.updateMany({ where: { id: accountId, historyId: current }, data: { historyId: next } })
}

async function renewWatchIfDue(
  token: string,
  account: { id: string; watchExpiresAt: Date | null },
  now: Date,
): Promise<MailSyncError | null> {
  const topic = process.env.GMAIL_PUBSUB_TOPIC
  // Tanpa topik: mode tarik-saja (cron 15 menit). Panel menampilkan "push mati", jadi ini
  // bukan kegagalan diam.
  if (!topic) return null
  if (account.watchExpiresAt && account.watchExpiresAt.getTime() - now.getTime() > WATCH_RENEW_MARGIN_MS) return null
  try {
    const watch = await gmailWatch(token, topic)
    await prisma.mailAccount.update({ where: { id: account.id }, data: { watchExpiresAt: new Date(Number(watch.expiration)) } })
    return null
  } catch (error) {
    console.error('syncMailAccount: perpanjangan watch gagal', { accountId: account.id, kind: error instanceof GmailError ? error.kind : 'unknown' })
    return 'WATCH_FAILED'
  }
}

export async function syncMailAccount(accountId: string, now: Date = new Date()): Promise<SyncResult> {
  const account = await prisma.mailAccount.findUniqueOrThrow({ where: { id: accountId } })
  const result: SyncResult = { accountId, emailAddress: account.emailAddress, ingested: 0, skipped: 0, error: null }

  try {
    const token = await getAccessToken(account)
    const { messageIds, nextHistoryId } = await collectNewMessageIds(token, account.historyId)

    let failed = false
    for (const id of messageIds) {
      try {
        const message = await gmailGetMessage(token, id)
        if (!message) {
          result.skipped += 1
          continue
        }
        const outcome = await ingestGmailMessage(account, message)
        if (outcome === 'created') result.ingested += 1
        else result.skipped += 1
      } catch (error) {
        failed = true
        console.error('syncMailAccount: satu email gagal diproses', {
          accountId, gmailMessageId: id, kind: error instanceof GmailError ? error.kind : 'unknown',
        })
      }
    }

    // Kursor tidak dimajukan melewati email yang gagal: putaran berikutnya mengambilnya lagi,
    // dan yang sudah berhasil ditahan externalId @unique.
    if (failed) result.error = 'INGEST_FAILED'
    else await advanceHistoryId(account.id, account.historyId, nextHistoryId)

    // Diperpanjang SELALU, juga saat ada email yang gagal: satu email rusak tidak boleh ikut
    // mematikan push untuk semua email berikutnya.
    const watchError = await renewWatchIfDue(token, account, now)
    result.error = result.error ?? watchError
  } catch (error) {
    if (error instanceof GmailError && error.kind === 'UNAUTHORIZED') invalidateAccessToken(accountId)
    result.error = error instanceof GmailError && error.kind === 'AUTH_REVOKED' ? 'AUTH_REVOKED' : 'GMAIL_HTTP'
    console.error('syncMailAccount: sinkronisasi gagal', { accountId, kind: error instanceof GmailError ? error.kind : 'unknown' })
  }

  await prisma.mailAccount.update({
    where: { id: accountId },
    data: result.error === null ? { lastSyncAt: now, lastSyncError: null } : { lastSyncError: result.error },
  })
  return result
}

const running = new Map<string, Promise<SyncResult>>()
const rerunRequested = new Set<string>()

/**
 * Satu sinkronisasi per kotak surat pada satu waktu. Bel yang berbunyi saat sinkronisasi
 * berjalan tidak diabaikan -- email pemicunya bisa tiba SETELAH history.list putaran ini
 * dibaca -- tapi juga tidak menumpuk: semua bel di tengah putaran dilebur jadi satu ulangan.
 */
export function requestSync(accountId: string): Promise<SyncResult> {
  const current = running.get(accountId)
  if (current) {
    rerunRequested.add(accountId)
    return current
  }
  const run = (async () => {
    try {
      let result = await syncMailAccount(accountId)
      while (rerunRequested.delete(accountId)) result = await syncMailAccount(accountId)
      return result
    } finally {
      running.delete(accountId)
    }
  })()
  running.set(accountId, run)
  return run
}

export async function syncAllMailAccounts(): Promise<SyncResult[]> {
  const accounts = await prisma.mailAccount.findMany({ select: { id: true }, orderBy: { createdAt: 'asc' } })
  const results: SyncResult[] = []
  // Berurutan, bukan paralel: kotak surat JVTO hanya dua, dan sinkronisasi berurutan tidak
  // pernah berebut CPU dengan balasan WhatsApp yang sedang ditunggu pelanggan.
  for (const account of accounts) results.push(await requestSync(account.id))
  return results
}

export function __resetSyncStateForTests(): void {
  running.clear()
  rerunRequested.clear()
}
```

- [ ] **Step 4: Jalankan test, pastikan LULUS**

Run: `npx vitest run src/lib/gmail/sync.test.ts && npx tsc --noEmit`
Expected: PASS, tsc exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/gmail/sync.ts src/lib/gmail/sync.test.ts
git commit -m "feat(email): sinkronisasi history Gmail dengan pemulihan kursor dan perpanjangan watch"
```

---

## Task 7: Endpoint — push, cron, OAuth, daftar kotak surat

**Files:**
- Create: `src/lib/gmail/push-auth.ts` (+ `push-auth.test.ts`)
- Create: `src/app/api/webhooks/gmail/route.ts` (+ `route.test.ts`)
- Create: `src/app/api/email/sync/route.ts` (+ `route.test.ts`)
- Create: `src/app/api/mail-accounts/route.ts` (+ `route.test.ts`)
- Create: `src/app/api/mail-accounts/oauth/start/route.ts`
- Create: `src/app/api/mail-accounts/oauth/callback/route.ts` (+ `route.test.ts`)
- Modify: `src/middleware.ts`

**Interfaces:**
- Consumes: `requestSync`, `syncAllMailAccounts`, `SyncResult` (Tugas 6); `buildGoogleAuthUrl`, `exchangeAuthCode`, `GMAIL_SCOPES`, `MAIL_OAUTH_STATE_COOKIE` (Tugas 2); `gmailGetProfile`, `invalidateAccessToken` (Tugas 2); `hasValidCronSecret`, `MIN_SECRET_LENGTH` (`@/lib/outbound/cron-auth`); `requireAdmin` (`@/lib/auth/require-admin`).
- Produces: `hasValidPushToken(url: URL): boolean`, `GMAIL_PUSH_TOKEN_ENV = 'GMAIL_PUSH_TOKEN'`. `GET /api/mail-accounts` → `{ pushConfigured: boolean; items: MailAccountView[] }` dengan `MailAccountView = { id: string; emailAddress: string; watchExpiresAt: string | null; lastSyncAt: string | null; lastSyncError: string | null; createdAt: string }`. Callback mengarahkan ke `/settings?section=kotak-surat&mail=<hasil>`, dengan `<hasil>` ∈ `tersambung | dibatalkan | state-tidak-cocok | tanpa-refresh-token | izin-kurang | gagal`.

- [ ] **Step 1: Tulis test yang gagal**

`src/lib/gmail/push-auth.test.ts`:

```ts
import { describe, it, expect, afterEach, vi } from 'vitest'
import { hasValidPushToken } from './push-auth'

afterEach(() => vi.unstubAllEnvs())
const TOKEN = 'x'.repeat(32)

describe('hasValidPushToken', () => {
  it('menerima token yang cocok', () => {
    vi.stubEnv('GMAIL_PUSH_TOKEN', TOKEN)
    expect(hasValidPushToken(new URL(`https://h/api/webhooks/gmail?token=${TOKEN}`))).toBe(true)
  })

  it('menolak token salah, token hilang, dan token dengan panjang berbeda', () => {
    vi.stubEnv('GMAIL_PUSH_TOKEN', TOKEN)
    expect(hasValidPushToken(new URL(`https://h/x?token=${'y'.repeat(32)}`))).toBe(false)
    expect(hasValidPushToken(new URL('https://h/x'))).toBe(false)
    expect(hasValidPushToken(new URL('https://h/x?token=pendek'))).toBe(false)
  })

  it('env kosong atau terlalu pendek = SELALU tolak, tidak pernah "biarkan lewat"', () => {
    vi.stubEnv('GMAIL_PUSH_TOKEN', '')
    expect(hasValidPushToken(new URL('https://h/x?token='))).toBe(false)
    vi.stubEnv('GMAIL_PUSH_TOKEN', 'pendek')
    expect(hasValidPushToken(new URL('https://h/x?token=pendek'))).toBe(false)
  })
})
```

`src/app/api/webhooks/gmail/route.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { requestSync } from '@/lib/gmail/sync'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/gmail/sync', () => ({ requestSync: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>
import { POST } from './route'

const TOKEN = 't'.repeat(32)
const push = (data: unknown, token = TOKEN) => new Request(`https://h/api/webhooks/gmail?token=${token}`, {
  method: 'POST',
  body: JSON.stringify({ message: { data: Buffer.from(JSON.stringify(data)).toString('base64'), messageId: '1' }, subscription: 's' }),
})

beforeEach(() => {
  mockReset(mockPrisma)
  vi.stubEnv('GMAIL_PUSH_TOKEN', TOKEN)
  vi.mocked(requestSync).mockReset().mockResolvedValue({} as never)
})

describe('POST /api/webhooks/gmail', () => {
  it('token salah: 403, tidak menyentuh database', async () => {
    const res = await POST(push({ emailAddress: 'hello@x.com' }, 'z'.repeat(32)))
    expect(res.status).toBe(403)
    expect(mockPrisma.mailAccount.findUnique).not.toHaveBeenCalled()
  })

  it('bel untuk kotak surat yang dikenal memicu sinkronisasi dan langsung ack 204', async () => {
    mockPrisma.mailAccount.findUnique.mockResolvedValue({ id: 'mail_1' } as never)
    const res = await POST(push({ emailAddress: 'Hello@X.com', historyId: 5 }))
    expect(res.status).toBe(204)
    expect(mockPrisma.mailAccount.findUnique).toHaveBeenCalledWith({ where: { emailAddress: 'hello@x.com' }, select: { id: true } })
    expect(requestSync).toHaveBeenCalledWith('mail_1')
  })

  it('kotak surat tak dikenal atau payload rusak: tetap ack 204 supaya Pub/Sub tidak mengulang selamanya', async () => {
    mockPrisma.mailAccount.findUnique.mockResolvedValue(null as never)
    expect((await POST(push({ emailAddress: 'lain@x.com' }))).status).toBe(204)
    expect((await POST(new Request(`https://h/api/webhooks/gmail?token=${TOKEN}`, { method: 'POST', body: 'bukan json' }))).status).toBe(204)
    expect(requestSync).not.toHaveBeenCalled()
  })
})
```

`src/app/api/email/sync/route.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { hasValidCronSecret } from '@/lib/outbound/cron-auth'
import { requireAdmin } from '@/lib/auth/require-admin'
import { syncAllMailAccounts } from '@/lib/gmail/sync'

vi.mock('@/lib/outbound/cron-auth', () => ({ hasValidCronSecret: vi.fn() }))
vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: vi.fn() }))
vi.mock('@/lib/gmail/sync', () => ({ syncAllMailAccounts: vi.fn() }))

import { POST } from './route'

beforeEach(() => {
  vi.mocked(hasValidCronSecret).mockReset().mockReturnValue(false)
  vi.mocked(requireAdmin).mockReset().mockResolvedValue(null)
  vi.mocked(syncAllMailAccounts).mockReset().mockResolvedValue([
    { accountId: 'mail_1', emailAddress: 'hello@x.com', ingested: 2, skipped: 0, error: null },
  ])
})

describe('POST /api/email/sync', () => {
  it('tanpa secret dan bukan admin: 403', async () => {
    expect((await POST(new Request('https://h/api/email/sync', { method: 'POST' }))).status).toBe(403)
    expect(syncAllMailAccounts).not.toHaveBeenCalled()
  })

  it('cron dengan secret yang sah menjalankan sinkronisasi', async () => {
    vi.mocked(hasValidCronSecret).mockReturnValue(true)
    const res = await POST(new Request('https://h/api/email/sync', { method: 'POST' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ results: [{ accountId: 'mail_1', emailAddress: 'hello@x.com', ingested: 2, skipped: 0, error: null }] })
  })

  it('admin boleh menekan "Sinkron sekarang"', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ accountId: 'a', role: 'ADMIN' } as never)
    expect((await POST(new Request('https://h/api/email/sync', { method: 'POST' }))).status).toBe(200)
  })
})
```

`src/app/api/mail-accounts/route.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/require-admin'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>
import { GET } from './route'

beforeEach(() => {
  mockReset(mockPrisma)
  vi.mocked(requireAdmin).mockReset().mockResolvedValue({ accountId: 'a', role: 'ADMIN' } as never)
  vi.stubEnv('GMAIL_PUBSUB_TOPIC', 'projects/p/topics/t')
})
afterEach(() => vi.unstubAllEnvs())

describe('GET /api/mail-accounts', () => {
  it('bukan admin: 403', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(null)
    expect((await GET(new Request('https://h/api/mail-accounts'))).status).toBe(403)
  })

  it('refresh token TIDAK PERNAH ada di respons, walau database mengembalikannya', async () => {
    mockPrisma.mailAccount.findMany.mockResolvedValue([{
      id: 'mail_1', emailAddress: 'hello@x.com', refreshToken: 'rt-rahasia-sekali', historyId: '1',
      watchExpiresAt: null, lastSyncAt: null, lastSyncError: 'AUTH_REVOKED', createdAt: new Date('2026-09-28T00:00:00Z'),
    }] as never)

    const res = await GET(new Request('https://h/api/mail-accounts'))
    const text = await res.text()
    expect(text).not.toContain('rt-rahasia-sekali')
    expect(text).not.toContain('refreshToken')
    expect(JSON.parse(text)).toEqual({
      pushConfigured: true,
      items: [{ id: 'mail_1', emailAddress: 'hello@x.com', watchExpiresAt: null, lastSyncAt: null, lastSyncError: 'AUTH_REVOKED', createdAt: '2026-09-28T00:00:00.000Z' }],
    })
  })
})
```

`src/app/api/mail-accounts/oauth/callback/route.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/require-admin'
import { exchangeAuthCode, GMAIL_SCOPES } from '@/lib/gmail/oauth'
import { gmailGetProfile } from '@/lib/gmail/client'
import { requestSync } from '@/lib/gmail/sync'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: vi.fn() }))
vi.mock('@/lib/gmail/oauth', async (orig) => ({ ...(await orig<typeof import('@/lib/gmail/oauth')>()), exchangeAuthCode: vi.fn() }))
vi.mock('@/lib/gmail/client', () => ({ gmailGetProfile: vi.fn(), invalidateAccessToken: vi.fn() }))
vi.mock('@/lib/gmail/sync', () => ({ requestSync: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>
import { GET } from './route'

function callback(query: string, stateCookie: string | null = 'state-ok') {
  const req = new NextRequest(`https://h/api/mail-accounts/oauth/callback?${query}`)
  if (stateCookie) req.cookies.set('mail_oauth_state', stateCookie)
  return GET(req)
}
const outcome = (res: Response) => new URL(res.headers.get('location') ?? '').searchParams.get('mail')

beforeEach(() => {
  mockReset(mockPrisma)
  vi.mocked(requireAdmin).mockReset().mockResolvedValue({ accountId: 'a', role: 'ADMIN' } as never)
  vi.mocked(exchangeAuthCode).mockReset().mockResolvedValue({ accessToken: 'at', refreshToken: 'rt', grantedScopes: [...GMAIL_SCOPES] })
  vi.mocked(gmailGetProfile).mockReset().mockResolvedValue({ emailAddress: 'Hello@X.com', historyId: '77' })
  vi.mocked(requestSync).mockReset().mockResolvedValue({} as never)
  mockPrisma.mailAccount.upsert.mockResolvedValue({ id: 'mail_1' } as never)
})

describe('GET /api/mail-accounts/oauth/callback', () => {
  it('state tidak cocok: ditolak, tidak menukar code', async () => {
    const res = await callback('code=c&state=state-lain')
    expect(outcome(res)).toBe('state-tidak-cocok')
    expect(exchangeAuthCode).not.toHaveBeenCalled()
  })

  it('tanpa cookie state: ditolak', async () => {
    expect(outcome(await callback('code=c&state=state-ok', null))).toBe('state-tidak-cocok')
  })

  it('pengguna membatalkan di layar Google', async () => {
    expect(outcome(await callback('error=access_denied&state=state-ok'))).toBe('dibatalkan')
  })

  it('izin kirim tidak dicentang di layar izin: ditolak, tidak disimpan', async () => {
    vi.mocked(exchangeAuthCode).mockResolvedValue({ accessToken: 'at', refreshToken: 'rt', grantedScopes: [GMAIL_SCOPES[0]] })
    expect(outcome(await callback('code=c&state=state-ok'))).toBe('izin-kurang')
    expect(mockPrisma.mailAccount.upsert).not.toHaveBeenCalled()
  })

  it('tanpa refresh token: ditolak, tidak disimpan', async () => {
    vi.mocked(exchangeAuthCode).mockResolvedValue({ accessToken: 'at', refreshToken: null, grantedScopes: [...GMAIL_SCOPES] })
    expect(outcome(await callback('code=c&state=state-ok'))).toBe('tanpa-refresh-token')
    expect(mockPrisma.mailAccount.upsert).not.toHaveBeenCalled()
  })

  it('sukses: alamat huruf kecil, kursor dari profil, sinkronisasi pertama dipicu, cookie state dihapus', async () => {
    const res = await callback('code=c&state=state-ok')
    expect(outcome(res)).toBe('tersambung')
    expect(mockPrisma.mailAccount.upsert).toHaveBeenCalledWith({
      where: { emailAddress: 'hello@x.com' },
      update: { refreshToken: 'rt', lastSyncError: null },
      create: { emailAddress: 'hello@x.com', refreshToken: 'rt', historyId: '77' },
      select: { id: true },
    })
    expect(requestSync).toHaveBeenCalledWith('mail_1')
    expect(res.headers.get('set-cookie')).toMatch(/mail_oauth_state=;/)
  })
})
```

- [ ] **Step 2: Jalankan, pastikan GAGAL**

Run: `npx vitest run src/lib/gmail/push-auth.test.ts src/app/api/webhooks/gmail src/app/api/email src/app/api/mail-accounts`
Expected: FAIL — modul belum ada.

- [ ] **Step 3: Implementasi**

`src/lib/gmail/push-auth.ts`:

```ts
import { timingSafeEqual } from 'node:crypto'
import { MIN_SECRET_LENGTH } from '@/lib/outbound/cron-auth'

/**
 * Token rahasia di query string langganan push Pub/Sub (keputusan D6).
 *
 * Cukup karena push hanya bel pintu: isinya tidak dipercaya untuk apa pun -- email selalu
 * diambil ulang dari Gmail dengan kredensial kita. Push palsu paling jauh memicu satu
 * sinkronisasi ekstra. Sifat keamanannya sama dengan cron-auth.ts: env kosong/pendek berarti
 * SELALU tolak, perbandingan timing-safe.
 */
export const GMAIL_PUSH_TOKEN_ENV = 'GMAIL_PUSH_TOKEN'

export function hasValidPushToken(url: URL): boolean {
  const expected = process.env[GMAIL_PUSH_TOKEN_ENV]
  if (!expected || expected.length < MIN_SECRET_LENGTH) return false
  const provided = url.searchParams.get('token')
  if (!provided) return false
  const a = Buffer.from(provided, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
```

`src/app/api/webhooks/gmail/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { hasValidPushToken } from '@/lib/gmail/push-auth'
import { requestSync } from '@/lib/gmail/sync'

/**
 * POST /api/webhooks/gmail — bel pintu Google Pub/Sub untuk Gmail users.watch().
 *
 * Payload-nya hanya { emailAddress, historyId }: BUKAN isi email. historyId dari push sengaja
 * diabaikan -- kursor kita sendiri (MailAccount.historyId) yang dipakai, supaya push yang
 * datang tidak berurutan tidak pernah membuat email terlewat.
 *
 * Sinkronisasi dijalankan di latar dan jawabannya langsung 204. Pub/Sub menganggap 2xx sebagai
 * ack; payload rusak dan kotak surat tak dikenal juga di-ack, karena mengulangnya tidak akan
 * pernah berhasil. Celah apa pun ditutup cron 15 menit.
 */
export async function POST(req: Request) {
  if (!hasValidPushToken(new URL(req.url))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let emailAddress: string | null = null
  try {
    const body = (await req.json()) as { message?: { data?: string } }
    const decoded = JSON.parse(Buffer.from(body.message?.data ?? '', 'base64').toString('utf8')) as { emailAddress?: unknown }
    emailAddress = typeof decoded.emailAddress === 'string' ? decoded.emailAddress.toLowerCase() : null
  } catch {
    return new NextResponse(null, { status: 204 })
  }
  if (!emailAddress) return new NextResponse(null, { status: 204 })

  try {
    const account = await prisma.mailAccount.findUnique({ where: { emailAddress }, select: { id: true } })
    if (account) {
      void requestSync(account.id).catch((error: unknown) => {
        console.error('webhook gmail: sinkronisasi gagal', { accountId: account.id, error: error instanceof Error ? error.name : 'unknown' })
      })
    }
    return new NextResponse(null, { status: 204 })
  } catch {
    return NextResponse.json({ error: 'Gagal memproses notifikasi' }, { status: 500 })
  }
}
```

`src/app/api/email/sync/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/require-admin'
import { hasValidCronSecret } from '@/lib/outbound/cron-auth'
import { syncAllMailAccounts } from '@/lib/gmail/sync'

/**
 * POST /api/email/sync — tarik email semua kotak surat, dan perpanjang watch() yang hampir mati.
 *
 * Dua pemanggil: crontab VPS tiap 15 menit dengan header `x-cron-secret`, dan admin yang
 * menekan "Sinkron sekarang" di Pengaturan. Secret dicek ulang di sini, bukan hanya di
 * middleware -- alasan yang sama dengan POST /api/daily-summary/generate.
 *
 * Respons hanya memuat alamat dan kategori error: tidak ada token, tidak ada teks error mentah.
 */
export async function POST(req: Request) {
  const authorized = hasValidCronSecret(req) || (await requireAdmin(req)) !== null
  if (!authorized) {
    return NextResponse.json({ error: 'Hanya admin atau scheduler yang bisa menyinkronkan email' }, { status: 403 })
  }
  try {
    return NextResponse.json({ results: await syncAllMailAccounts() })
  } catch {
    return NextResponse.json({ error: 'Gagal menyinkronkan email' }, { status: 500 })
  }
}
```

`src/app/api/mail-accounts/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/require-admin'

/**
 * GET /api/mail-accounts — kotak surat yang tersambung, untuk panel Pengaturan.
 *
 * refreshToken TIDAK PERNAH keluar dari sini (CLAUDE.md §5). Dijaga dua lapis: `select` tanpa
 * kolom itu, DAN pemetaan eksplisit di bawah -- kalau suatu hari `select` dihapus orang,
 * token tetap tidak ikut terserialisasi.
 */
export async function GET(req: Request) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: 'Hanya admin yang bisa melihat kotak surat' }, { status: 403 })
  }
  try {
    const accounts = await prisma.mailAccount.findMany({
      select: { id: true, emailAddress: true, watchExpiresAt: true, lastSyncAt: true, lastSyncError: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    })
    return NextResponse.json({
      pushConfigured: Boolean(process.env.GMAIL_PUBSUB_TOPIC),
      items: accounts.map((a) => ({
        id: a.id,
        emailAddress: a.emailAddress,
        watchExpiresAt: a.watchExpiresAt?.toISOString() ?? null,
        lastSyncAt: a.lastSyncAt?.toISOString() ?? null,
        lastSyncError: a.lastSyncError,
        createdAt: a.createdAt.toISOString(),
      })),
    })
  } catch {
    return NextResponse.json({ error: 'Gagal memuat kotak surat' }, { status: 500 })
  }
}
```

`src/app/api/mail-accounts/oauth/start/route.ts`:

```ts
import { randomBytes } from 'node:crypto'
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/require-admin'
import { buildGoogleAuthUrl, MAIL_OAUTH_STATE_COOKIE } from '@/lib/gmail/oauth'

/**
 * GET /api/mail-accounts/oauth/start — arahkan admin ke layar izin Google.
 *
 * `state` acak disimpan di cookie httpOnly berumur 10 menit dan dicocokkan di callback --
 * tanpa itu, siapa pun bisa membuat admin yang sedang login tanpa sadar menyambungkan kotak
 * surat MILIK PENYERANG ke Inbox JVTO (CSRF login). sameSite 'lax' wajib: cookie harus ikut
 * saat Google mengarahkan balik lewat navigasi tingkat atas.
 */
export async function GET(req: Request) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: 'Hanya admin yang bisa menyambungkan kotak surat' }, { status: 403 })
  }
  try {
    const state = randomBytes(24).toString('base64url')
    const res = NextResponse.redirect(buildGoogleAuthUrl(state))
    res.cookies.set(MAIL_OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/mail-accounts/oauth',
      maxAge: 600,
    })
    return res
  } catch {
    return NextResponse.json({ error: 'Google OAuth belum dikonfigurasi di server' }, { status: 500 })
  }
}
```

`src/app/api/mail-accounts/oauth/callback/route.ts`:

```ts
import { timingSafeEqual } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/require-admin'
import { exchangeAuthCode, GMAIL_SCOPES, MAIL_OAUTH_STATE_COOKIE } from '@/lib/gmail/oauth'
import { gmailGetProfile, invalidateAccessToken } from '@/lib/gmail/client'
import { GmailError } from '@/lib/gmail/errors'
import { requestSync } from '@/lib/gmail/sync'

type Outcome = 'tersambung' | 'dibatalkan' | 'state-tidak-cocok' | 'tanpa-refresh-token' | 'izin-kurang' | 'gagal'

function sameState(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8')
  const y = Buffer.from(b, 'utf8')
  return x.length === y.length && timingSafeEqual(x, y)
}

/**
 * GET /api/mail-accounts/oauth/callback — Google mengarahkan kembali ke sini setelah layar izin.
 *
 * Selalu berakhir dengan redirect ke panel Pengaturan membawa `?mail=<hasil>`, tidak pernah
 * JSON: yang membuka URL ini adalah browser admin, bukan program.
 */
export async function GET(req: NextRequest) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: 'Hanya admin yang bisa menyambungkan kotak surat' }, { status: 403 })
  }

  const finish = (outcome: Outcome) => {
    const res = NextResponse.redirect(new URL(`/settings?section=kotak-surat&mail=${outcome}`, req.url))
    res.cookies.set(MAIL_OAUTH_STATE_COOKIE, '', { path: '/api/mail-accounts/oauth', maxAge: 0 })
    return res
  }

  const params = req.nextUrl.searchParams
  const expected = req.cookies.get(MAIL_OAUTH_STATE_COOKIE)?.value
  const state = params.get('state')
  if (!expected || !state || !sameState(state, expected)) return finish('state-tidak-cocok')
  if (params.get('error')) return finish('dibatalkan')
  const code = params.get('code')
  if (!code) return finish('gagal')

  try {
    const tokens = await exchangeAuthCode(code)
    // Layar izin Google membolehkan pengguna tidak mencentang sebagian scope. Kotak surat
    // tanpa izin kirim akan tampak tersambung lalu gagal di balasan PERTAMA -- tolak di sini.
    if (!GMAIL_SCOPES.every((scope) => tokens.grantedScopes.includes(scope))) return finish('izin-kurang')
    if (!tokens.refreshToken) return finish('tanpa-refresh-token')

    const profile = await gmailGetProfile(tokens.accessToken)
    const emailAddress = profile.emailAddress.toLowerCase()
    const account = await prisma.mailAccount.upsert({
      where: { emailAddress },
      // Menyambung ulang mempertahankan kursor lama: email yang masuk selama token mati
      // tertarik di sinkronisasi berikutnya (atau lewat pemulihan 7 hari kalau kursornya
      // sudah terlalu tua).
      update: { refreshToken: tokens.refreshToken, lastSyncError: null },
      create: { emailAddress, refreshToken: tokens.refreshToken, historyId: profile.historyId },
      select: { id: true },
    })
    invalidateAccessToken(account.id)
    // Sinkronisasi pertama langsung: ia yang memasang watch(), jadi push hidup tanpa menunggu cron.
    void requestSync(account.id).catch(() => {})
    return finish('tersambung')
  } catch (error) {
    console.error('oauth callback kotak surat gagal', { kind: error instanceof GmailError ? error.kind : 'unknown' })
    return finish('gagal')
  }
}
```

Di `src/middleware.ts`:

1. Tambahkan `'/api/webhooks/gmail',` ke `PUBLIC_PATHS` tepat di bawah `'/api/webhooks/meta',`. Route-nya sendiri yang memeriksa token.
2. Ganti `const CRON_PATHS = new Set(['/api/outbound-jobs/process', '/api/daily-summary/generate'])` menjadi:

```ts
const CRON_PATHS = new Set(['/api/outbound-jobs/process', '/api/daily-summary/generate', '/api/email/sync'])
```

- [ ] **Step 4: Jalankan test, pastikan LULUS**

Run: `npx vitest run src/lib/gmail src/app/api/webhooks/gmail src/app/api/email src/app/api/mail-accounts && npx tsc --noEmit`
Expected: PASS, tsc exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/gmail/push-auth.ts src/lib/gmail/push-auth.test.ts src/app/api/webhooks/gmail src/app/api/email src/app/api/mail-accounts src/middleware.ts
git commit -m "feat(email): endpoint push Gmail, cron sinkronisasi, dan OAuth kotak surat"
```

---

## Task 8: Jalur kirim EMAIL

**Files:**
- Create: `src/lib/gmail/mime.ts` (+ `mime.test.ts`)
- Create: `src/lib/gmail/send.ts` (+ `send.test.ts`)
- Modify: `src/lib/send.ts` (tipe `platform` + satu cabang)
- Modify: `src/lib/send.test.ts` (satu test rute)
- Modify: `docs/superpowers/specs/check-omnichannel-design.mjs`

**Interfaces:**
- Consumes: `getAccessToken`, `gmailGetMessageHeaders`, `gmailSendRaw` (Tugas 2); `WA_INBOX_ID_HEADER` (Tugas 3); `OutboundMedia` (type, `@/lib/send`).
- Produces: `buildReplyMime(input: ReplyMimeInput): string` (base64url), `replySubject(subject: string | null): string`, `encodeHeaderWord(value: string): string`, `sendEmailMessage(params: EmailSendParams, botTrace: Prisma.InputJsonValue | undefined)` yang mengembalikan baris `Message` dengan `include: { replyTo: true }`, bentuk yang sama dengan kembalian `sendMessage` lainnya.

Urutan di `sendEmailMessage` (berbeda dari Messenger, dan disengaja):
1. Lampiran → FAILED terlihat, nol panggilan Gmail (D9).
2. Tanpa identitas/kotak surat/threadId → FAILED terlihat.
3. Buat baris **PENDING dulu** supaya id-nya bisa dipasang sebagai `X-WA-Inbox-Id`. Itulah yang membuat salinan `SENT` yang tersinkron balik dikenali sebagai milik kita (Tugas 5), bukan dicatat dua kali.
4. Ambil `Message-ID`/`References`/`Subject` dari pesan terakhir benang yang punya `externalId`, susun MIME, lalu kirim dengan `threadId`.
5. Perbarui barisnya jadi SENT (+ `externalId`) atau FAILED, lalu broadcast `message.updated`.

- [ ] **Step 1: Tulis test yang gagal**

`src/lib/gmail/mime.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildReplyMime, replySubject, encodeHeaderWord } from './mime'

const decode = (raw: string) => Buffer.from(raw, 'base64url').toString('utf8')
const base = {
  from: 'hello@javavolcano-touroperator.com', to: 'sinta@example.com', subject: 'Re: Tur Bromo',
  inReplyTo: '<abc@mail.gmail.com>', references: '<root@x> <abc@mail.gmail.com>', waInboxId: 'msg_1', text: 'Halo Sinta,\nSlot masih ada.',
}

describe('replySubject', () => {
  it('menambah "Re: " sekali saja', () => {
    expect(replySubject('Tur Bromo')).toBe('Re: Tur Bromo')
    expect(replySubject('RE: Tur Bromo')).toBe('RE: Tur Bromo')
    expect(replySubject(null)).toBe('Re: (tanpa subjek)')
  })
})

describe('encodeHeaderWord', () => {
  it('ASCII apa adanya, non-ASCII jadi encoded-word UTF-8', () => {
    expect(encodeHeaderWord('Re: Bromo')).toBe('Re: Bromo')
    expect(encodeHeaderWord('Re: Bromo 🌋')).toBe(`=?UTF-8?B?${Buffer.from('Re: Bromo 🌋').toString('base64')}?=`)
  })
})

describe('buildReplyMime', () => {
  it('menyusun header balasan yang menjaga thread', () => {
    const mime = decode(buildReplyMime(base))
    const [head] = mime.split('\r\n\r\n')
    expect(head).toContain('From: hello@javavolcano-touroperator.com')
    expect(head).toContain('To: sinta@example.com')
    expect(head).toContain('Subject: Re: Tur Bromo')
    expect(head).toContain('In-Reply-To: <abc@mail.gmail.com>')
    expect(head).toContain('References: <root@x> <abc@mail.gmail.com>')
    expect(head).toContain('X-WA-Inbox-Id: msg_1')
    expect(head).toContain('Content-Type: text/plain; charset="UTF-8"')
  })

  it('References dibangun dari In-Reply-To kalau pesan asal tidak punya References', () => {
    const head = decode(buildReplyMime({ ...base, references: null })).split('\r\n\r\n')[0]
    expect(head).toContain('References: <abc@mail.gmail.com>')
  })

  it('isi di-encode base64 dan kembali utuh (termasuk non-ASCII)', () => {
    const mime = decode(buildReplyMime({ ...base, text: 'Terima kasih 🙏\nSalam, JVTO' }))
    const body = mime.split('\r\n\r\n')[1].replace(/\r\n/g, '')
    expect(Buffer.from(body, 'base64').toString('utf8')).toBe('Terima kasih 🙏\r\nSalam, JVTO')
  })

  it('CR/LF di nilai header tidak bisa menyuntik header baru', () => {
    const mime = decode(buildReplyMime({ ...base, subject: 'Halo\r\nBcc: korban@x.com', to: 'sinta@example.com\nBcc: korban@x.com' }))
    const head = mime.split('\r\n\r\n')[0]
    expect(head.split('\r\n').some((line) => line.startsWith('Bcc:'))).toBe(false)
  })
})
```

`src/lib/gmail/send.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { broadcast } from '@/lib/realtime'
import { getAccessToken, gmailGetMessageHeaders, gmailSendRaw } from './client'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/realtime', () => ({ broadcast: vi.fn() }))
vi.mock('./client', () => ({ getAccessToken: vi.fn(), gmailGetMessageHeaders: vi.fn(), gmailSendRaw: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>
import { sendEmailMessage } from './send'

const conversation = {
  externalThreadId: 'th_1', subject: 'Tur Bromo',
  channelIdentity: { externalId: 'sinta@example.com' },
  mailAccount: { id: 'mail_1', emailAddress: 'hello@javavolcano-touroperator.com', refreshToken: 'rt' },
}
const params = { conversationId: 'conv_1', text: 'Slot masih ada.', sentBy: 'AGENT' as const, agentId: 'acc_1' }
const decode = (raw: string) => Buffer.from(raw, 'base64url').toString('utf8')

beforeEach(() => {
  mockReset(mockPrisma)
  vi.mocked(broadcast).mockReset()
  mockPrisma.conversation.findUniqueOrThrow.mockResolvedValue(conversation as never)
  mockPrisma.message.create.mockResolvedValue({ id: 'msg_new', conversationId: 'conv_1' } as never)
  mockPrisma.message.update.mockResolvedValue({ id: 'msg_new', conversationId: 'conv_1', deliveryStatus: 'SENT' } as never)
  mockPrisma.message.findFirst.mockResolvedValue({ externalId: 'gm_last' } as never)
  vi.mocked(getAccessToken).mockReset().mockResolvedValue('at')
  vi.mocked(gmailGetMessageHeaders).mockReset().mockResolvedValue({ 'message-id': '<last@x>', subject: 'Re: Tur Bromo' })
  vi.mocked(gmailSendRaw).mockReset().mockResolvedValue({ id: 'gm_sent', threadId: 'th_1' })
})

describe('sendEmailMessage', () => {
  it('membuat baris PENDING dulu, mengirim dari alamat yang disurati dengan X-WA-Inbox-Id baris itu, lalu SENT', async () => {
    await sendEmailMessage(params, undefined)

    expect(mockPrisma.message.create.mock.calls[0][0].data).toMatchObject({ deliveryStatus: 'PENDING', channel: 'OFFICIAL', direction: 'OUTBOUND' })
    const [, raw, threadId] = vi.mocked(gmailSendRaw).mock.calls[0]
    expect(threadId).toBe('th_1')
    const head = decode(raw).split('\r\n\r\n')[0]
    expect(head).toContain('From: hello@javavolcano-touroperator.com')
    expect(head).toContain('To: sinta@example.com')
    expect(head).toContain('In-Reply-To: <last@x>')
    expect(head).toContain('X-WA-Inbox-Id: msg_new')
    expect(mockPrisma.message.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'msg_new' }, data: { deliveryStatus: 'SENT', externalId: 'gm_sent' },
    }))
    expect(vi.mocked(broadcast).mock.calls.map((c) => c[0].type)).toEqual(['message.created', 'message.updated'])
  })

  it('pesan jangkar tidak pernah baris yang baru saja dibuat', async () => {
    await sendEmailMessage(params, undefined)
    expect(mockPrisma.message.findFirst.mock.calls[0][0]?.where).toMatchObject({
      conversationId: 'conv_1', externalId: { not: null }, id: { not: 'msg_new' },
    })
  })

  it('benang tanpa pesan jangkar tetap terkirim, subjek dari Conversation.subject', async () => {
    mockPrisma.message.findFirst.mockResolvedValue(null as never)
    await sendEmailMessage(params, undefined)
    expect(gmailGetMessageHeaders).not.toHaveBeenCalled()
    expect(decode(vi.mocked(gmailSendRaw).mock.calls[0][1])).toContain('Subject: Re: Tur Bromo')
  })

  it('Gmail menolak: baris jadi FAILED, tidak melempar', async () => {
    vi.mocked(gmailSendRaw).mockRejectedValue(new Error('boom'))
    await sendEmailMessage(params, undefined)
    expect(mockPrisma.message.update).toHaveBeenCalledWith(expect.objectContaining({ data: { deliveryStatus: 'FAILED' } }))
  })

  it('lampiran ditolak TERLIHAT, nol panggilan Gmail', async () => {
    await sendEmailMessage({ ...params, media: { url: 'https://x/f.pdf', type: 'document', mimeType: 'application/pdf' } }, undefined)
    expect(gmailSendRaw).not.toHaveBeenCalled()
    expect(mockPrisma.message.create.mock.calls[0][0].data).toMatchObject({ deliveryStatus: 'FAILED' })
    expect(String(mockPrisma.message.create.mock.calls[0][0].data.content)).toContain('lampiran lewat email belum didukung')
  })

  it('percakapan tanpa kotak surat: FAILED terlihat, nol panggilan Gmail', async () => {
    mockPrisma.conversation.findUniqueOrThrow.mockResolvedValue({ ...conversation, mailAccount: null } as never)
    await sendEmailMessage(params, undefined)
    expect(gmailSendRaw).not.toHaveBeenCalled()
    expect(mockPrisma.message.create.mock.calls[0][0].data).toMatchObject({ deliveryStatus: 'FAILED' })
  })
})
```

Tambahkan ke `src/lib/send.test.ts`, di dekat test rute Instagram/Facebook yang sudah ada. Ikuti pola mock di kepala file itu. Kalau `@/lib/gmail/send` belum di-mock di sana, tambahkan `vi.mock('@/lib/gmail/send', () => ({ sendEmailMessage: vi.fn() }))` beserta import-nya.

```ts
it('percakapan EMAIL dirutekan ke sendEmailMessage, tidak menyentuh jalur WhatsApp', async () => {
  mockPrisma.conversation.findUniqueOrThrow.mockResolvedValue({
    id: 'conv_mail', isTest: false, contact: { phone: null }, channelIdentity: { platform: 'EMAIL', externalId: 'sinta@example.com' },
  } as never)
  vi.mocked(sendEmailMessage).mockResolvedValue({ id: 'msg_mail' } as never)

  const result = await sendMessage({ conversationId: 'conv_mail', text: 'Halo', sentBy: 'AGENT' })

  expect(result).toEqual({ id: 'msg_mail' })
  expect(sendEmailMessage).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'conv_mail', text: 'Halo' }), undefined)
  expect(mockPrisma.waNumber.findFirstOrThrow).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Jalankan, pastikan GAGAL**

Run: `npx vitest run src/lib/gmail/mime.test.ts src/lib/gmail/send.test.ts src/lib/send.test.ts`
Expected: FAIL — modul belum ada, dan `sendMessage` belum mengenal `EMAIL`.

- [ ] **Step 3: Implementasi**

`src/lib/gmail/mime.ts`:

```ts
import { WA_INBOX_ID_HEADER } from './parse'

/**
 * MIME RFC 2822 untuk satu balasan teks polos, dalam base64url (bentuk `raw` Gmail).
 *
 * Setiap nilai header dilewatkan stripCrlf: subjek dan alamat berasal dari email pelanggan,
 * dan satu CR/LF di sana cukup untuk menyuntik `Bcc:` ke balasan JVTO.
 */
export interface ReplyMimeInput {
  from: string
  to: string
  subject: string
  inReplyTo: string | null
  references: string | null
  waInboxId: string
  text: string
}

const stripCrlf = (value: string) => value.replace(/[\r\n]+/g, ' ').trim()

export function encodeHeaderWord(value: string): string {
  const clean = stripCrlf(value)
  return /^[\x20-\x7e]*$/.test(clean) ? clean : `=?UTF-8?B?${Buffer.from(clean, 'utf8').toString('base64')}?=`
}

export function replySubject(subject: string | null): string {
  const base = stripCrlf(subject ?? '')
  if (!base) return 'Re: (tanpa subjek)'
  return /^re:/i.test(base) ? base : `Re: ${base}`
}

export function buildReplyMime(input: ReplyMimeInput): string {
  const references = [input.references, input.inReplyTo].filter((v): v is string => Boolean(v)).join(' ')
  const headers = [
    `From: ${stripCrlf(input.from)}`,
    `To: ${stripCrlf(input.to)}`,
    `Subject: ${encodeHeaderWord(input.subject)}`,
    ...(input.inReplyTo ? [`In-Reply-To: ${stripCrlf(input.inReplyTo)}`] : []),
    // Kalau References asal sudah memuat In-Reply-To, ia muncul dua kali. Pembaca email
    // mentoleransinya, dan membuang duplikat tidak sepadan dengan risiko salah memotong.
    ...(references ? [`References: ${stripCrlf(references)}`] : []),
    `${WA_INBOX_ID_HEADER}: ${stripCrlf(input.waInboxId)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
  ]
  const body = Buffer.from(input.text.replace(/\r?\n/g, '\r\n'), 'utf8')
    .toString('base64')
    .replace(/.{1,76}/g, '$&\r\n')
  return Buffer.from(`${headers.join('\r\n')}\r\n\r\n${body}`, 'utf8').toString('base64url')
}
```

`src/lib/gmail/send.ts`:

```ts
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { broadcast } from '@/lib/realtime'
import { withMediaUrl } from '@/lib/serialize-message'
import type { OutboundMedia } from '@/lib/send'
import { getAccessToken, gmailGetMessageHeaders, gmailSendRaw } from './client'
import { GmailError } from './errors'
import { buildReplyMime, replySubject } from './mime'

export interface EmailSendParams {
  conversationId: string
  text: string
  sentBy: 'AGENT' | 'BOT'
  agentId?: string
  replyToId?: string
  media?: OutboundMedia
}

/**
 * Jalur kirim EMAIL (spec §7): Gmail messages.send, threadId dipertahankan, FROM = kotak surat
 * yang disurati (spec §4.3). Balasan ikut masuk folder Sent Gmail -- siapa pun yang membuka
 * Gmail melihat percakapan yang sama.
 *
 * Baris Message dibuat PENDING SEBELUM panggilan Gmail, berbeda dengan jalur Messenger, karena
 * id-nya harus sudah ada untuk dipasang sebagai header X-WA-Inbox-Id. Dari header itulah
 * sinkronisasi (src/lib/gmail/ingest.ts) mengenali salinan SENT sebagai milik kita dan tidak
 * mencatatnya dua kali.
 */
export async function sendEmailMessage(params: EmailSendParams, botTrace: Prisma.InputJsonValue | undefined) {
  const base = {
    conversationId: params.conversationId,
    direction: 'OUTBOUND' as const,
    type: 'text',
    channel: 'OFFICIAL' as const,
    sentBy: params.sentBy,
    agentId: params.agentId,
    botTrace: botTrace as never,
    replyToId: params.replyToId,
  }

  const recordFailed = async (content: string | null) => {
    const failed = await prisma.message.create({ data: { ...base, content, deliveryStatus: 'FAILED' }, include: { replyTo: true } })
    broadcast({ type: 'message.created', conversationId: params.conversationId, message: withMediaUrl(failed) })
    return failed
  }

  // Keputusan D9, sama dengan jalur Messenger: gagal TERLIHAT, bukan diam-diam mengirim teksnya
  // saja dan kehilangan lampirannya.
  if (params.media) {
    return recordFailed('Kirim lampiran lewat email belum didukung -- kirim teks, atau balas lewat Gmail')
  }

  const conversation = await prisma.conversation.findUniqueOrThrow({
    where: { id: params.conversationId },
    select: {
      externalThreadId: true,
      subject: true,
      channelIdentity: { select: { externalId: true } },
      mailAccount: { select: { id: true, emailAddress: true, refreshToken: true } },
    },
  })
  const to = conversation.channelIdentity?.externalId
  const account = conversation.mailAccount
  if (!to || !account || !conversation.externalThreadId) {
    console.error('sendEmailMessage: percakapan email tanpa penerima, kotak surat, atau thread', { conversationId: params.conversationId })
    return recordFailed(params.text || null)
  }

  const pending = await prisma.message.create({
    data: { ...base, content: params.text || null, deliveryStatus: 'PENDING' },
    include: { replyTo: true },
  })
  broadcast({ type: 'message.created', conversationId: params.conversationId, message: withMediaUrl(pending) })

  let externalId: string | undefined
  let deliveryStatus: 'SENT' | 'FAILED' = 'SENT'
  try {
    const token = await getAccessToken(account)
    const anchor = await prisma.message.findFirst({
      where: { conversationId: params.conversationId, externalId: { not: null }, id: { not: pending.id } },
      orderBy: { createdAt: 'desc' },
      select: { externalId: true },
    })
    const headers = anchor?.externalId
      ? await gmailGetMessageHeaders(token, anchor.externalId, ['Message-ID', 'References', 'Subject'])
      : {}
    const raw = buildReplyMime({
      from: account.emailAddress,
      to,
      subject: replySubject(headers.subject ?? conversation.subject),
      inReplyTo: headers['message-id'] ?? null,
      references: headers.references ?? null,
      waInboxId: pending.id,
      text: params.text,
    })
    externalId = (await gmailSendRaw(token, raw, conversation.externalThreadId)).id
  } catch (error) {
    console.error('sendEmailMessage: pengiriman gagal', {
      conversationId: params.conversationId, kind: error instanceof GmailError ? error.kind : 'unknown',
    })
    deliveryStatus = 'FAILED'
  }

  const updated = await prisma.message.update({
    where: { id: pending.id },
    data: externalId ? { deliveryStatus, externalId } : { deliveryStatus },
    include: { replyTo: true },
  })
  broadcast({ type: 'message.updated', conversationId: params.conversationId, message: withMediaUrl(updated) })
  return updated
}
```

Di `src/lib/send.ts`:

1. Tambahkan import di blok import atas: `import { sendEmailMessage } from '@/lib/gmail/send'`.
2. Ubah tipe parameter `platform?: 'WHATSAPP' | 'FACEBOOK' | 'INSTAGRAM'` menjadi `platform?: 'WHATSAPP' | 'FACEBOOK' | 'INSTAGRAM' | 'EMAIL'`.
3. Tepat **sebelum** baris `if (platform === 'FACEBOOK' || platform === 'INSTAGRAM') {`, sisipkan:

```ts
  // Email punya jalurnya sendiri (src/lib/gmail/send.ts): tidak ada capability matrix, tidak
  // ada nomor telepon, dan penerimanya alamat di ChannelIdentity.externalId. Dicek duluan
  // supaya percakapan email tidak pernah jatuh ke gerbang `contact.phone` WhatsApp di bawah.
  if (platform === 'EMAIL') {
    return sendEmailMessage(params, botTrace)
  }
```

Kalau `tsc` menolak `params` karena bentuknya lebih lebar dari `EmailSendParams`, **jangan** longgarkan `EmailSendParams`. Teruskan field-nya eksplisit: `{ conversationId, text, sentBy, agentId, replyToId, media }`.

Tambahkan ke `docs/superpowers/specs/check-omnichannel-design.mjs`, tepat di bawah baris `mustContain('src/lib/send.ts', /platform === 'FACEBOOK' \|\| platform === 'INSTAGRAM'/, ...)`:

```js
// Fase email: cabang kirim EMAIL, dan balasan keluar dari alamat yang disurati (§4.3, §7).
mustContain('src/lib/send.ts', /platform === 'EMAIL'/, 'cabang kirim EMAIL')
mustContain('src/lib/gmail/send.ts', /mailAccount: \{ select: \{ id: true, emailAddress: true/, 'FROM dari Conversation.mailAccount, bukan disimpulkan')
```

- [ ] **Step 4: Jalankan test, pastikan LULUS**

Run: `npx vitest run src/lib/gmail src/lib/send.test.ts && npx tsc --noEmit && node docs/superpowers/specs/check-omnichannel-design.mjs`
Expected: PASS, tsc exit 0, pemeriksa hijau.

- [ ] **Step 5: Commit**

```bash
git add src/lib/gmail/mime.ts src/lib/gmail/mime.test.ts src/lib/gmail/send.ts src/lib/gmail/send.test.ts src/lib/send.ts src/lib/send.test.ts docs/superpowers/specs/check-omnichannel-design.mjs
git commit -m "feat(email): balas email dari Inbox lewat Gmail API, thread dipertahankan"
```

---

## Task 9: Panel "Kotak surat email" di Pengaturan

**Files:**
- Create: `src/components/settings/MailAccountsPanel.tsx` (+ `MailAccountsPanel.test.tsx`)
- Modify: `src/app/(authenticated)/settings/page.tsx`

**Interfaces:**
- Consumes: `GET /api/mail-accounts`, `POST /api/email/sync`, `GET /api/mail-accounts/oauth/start` (Tugas 7).
- Produces: `MailAccountsPanel(): JSX.Element`, dan helper murni yang ikut diekspor untuk test: `describeSyncError(code: string | null): string | null`, `pushStatus(watchExpiresAt: string | null, pushConfigured: boolean, now?: Date): { label: string; tone: 'success' | 'warning' }`, `MAIL_FLASH: Record<string, string>`.

- [ ] **Step 1: Tulis test yang gagal**

`src/components/settings/MailAccountsPanel.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MailAccountsPanel, describeSyncError, pushStatus, MAIL_FLASH } from './MailAccountsPanel'

describe('describeSyncError', () => {
  it('memetakan setiap kategori ke kalimat yang bisa ditindaklanjuti', () => {
    expect(describeSyncError(null)).toBeNull()
    expect(describeSyncError('AUTH_REVOKED')).toContain('Sambungkan ulang')
    expect(describeSyncError('WATCH_FAILED')).toContain('15 menit')
    expect(describeSyncError('KATEGORI_BARU')).toContain('KATEGORI_BARU')
  })
})

describe('pushStatus', () => {
  const now = new Date('2026-09-28T00:00:00Z')
  it('push tidak dikonfigurasi terlihat sebagai peringatan, bukan diam', () => {
    expect(pushStatus(null, false, now)).toEqual({ label: 'Push mati — hanya tarikan 15 menit', tone: 'warning' })
  })
  it('watch yang sudah lewat terlihat sebagai peringatan', () => {
    expect(pushStatus('2026-09-27T00:00:00Z', true, now).tone).toBe('warning')
  })
  it('watch aktif', () => {
    expect(pushStatus('2026-10-03T00:00:00Z', true, now).tone).toBe('success')
  })
})

describe('MailAccountsPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        pushConfigured: true,
        items: [{
          id: 'mail_1', emailAddress: 'hello@javavolcano-touroperator.com', watchExpiresAt: '2099-01-01T00:00:00Z',
          lastSyncAt: '2026-09-28T00:00:00Z', lastSyncError: 'AUTH_REVOKED', createdAt: '2026-09-28T00:00:00Z',
        }],
      }),
    }))
  })

  it('menampilkan alamat dan error sinkronisasi yang bisa ditindaklanjuti', async () => {
    render(<MailAccountsPanel />)
    await waitFor(() => expect(screen.getByText('hello@javavolcano-touroperator.com')).toBeInTheDocument())
    expect(screen.getByText(/Sambungkan ulang/)).toBeInTheDocument()
  })

  it('tombol sambungkan menuju endpoint OAuth', async () => {
    render(<MailAccountsPanel />)
    const link = await screen.findByRole('link', { name: 'Sambungkan kotak surat' })
    expect(link).toHaveAttribute('href', '/api/mail-accounts/oauth/start')
  })

  it('setiap hasil callback punya pesan', () => {
    for (const key of ['tersambung', 'dibatalkan', 'state-tidak-cocok', 'tanpa-refresh-token', 'izin-kurang', 'gagal']) {
      expect(MAIL_FLASH[key]).toBeTruthy()
    }
  })
})
```

- [ ] **Step 2: Jalankan, pastikan GAGAL**

Run: `npx vitest run src/components/settings/MailAccountsPanel.test.tsx`
Expected: FAIL — modul belum ada.

- [ ] **Step 3: Implementasi**

`src/components/settings/MailAccountsPanel.tsx`:

```tsx
'use client'
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { FieldError } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { FormSection } from '@/components/settings/section'
import { fetchJson, FetchJsonError } from '@/lib/fetch-json'

/**
 * Kotak surat Google milik JVTO yang tersambung ke Inbox.
 *
 * Panel ini ada supaya dua kegagalan yang sifatnya DIAM jadi terlihat: token yang dicabut
 * (email berhenti masuk, tanpa error di mana pun) dan push yang mati (email tetap masuk, tapi
 * telat sampai 15 menit). Keduanya tidak pernah dilaporkan siapa pun kalau tidak tampil di sini.
 */
type MailAccountView = {
  id: string
  emailAddress: string
  watchExpiresAt: string | null
  lastSyncAt: string | null
  lastSyncError: string | null
  createdAt: string
}

export const MAIL_FLASH: Record<string, string> = {
  tersambung: 'Kotak surat tersambung. Email baru akan muncul di Inbox dalam beberapa detik.',
  dibatalkan: 'Penyambungan dibatalkan di layar Google.',
  'state-tidak-cocok': 'Sesi penyambungan kedaluwarsa atau tidak cocok. Ulangi dari tombol di bawah.',
  'tanpa-refresh-token': 'Google tidak mengirim token jangka panjang. Cabut akses app ini di akun Google, lalu sambungkan ulang.',
  'izin-kurang': 'Izin membaca DAN mengirim email harus dicentang keduanya di layar Google. Ulangi penyambungan.',
  gagal: 'Penyambungan gagal. Coba lagi; kalau berulang, periksa konfigurasi OAuth di server.',
}

export function describeSyncError(code: string | null): string | null {
  if (code === null) return null
  switch (code) {
    case 'AUTH_REVOKED':
      return 'Akses ke kotak surat dicabut (password diganti atau izin dicabut). Sambungkan ulang.'
    case 'WATCH_FAILED':
      return 'Push gagal diperpanjang. Email tetap masuk lewat tarikan 15 menit.'
    case 'INGEST_FAILED':
      return 'Sebagian email gagal diproses dan akan dicoba lagi otomatis.'
    case 'GMAIL_HTTP':
      return 'Gmail tidak bisa dihubungi. Dicoba lagi otomatis tiap 15 menit.'
    default:
      return `Kesalahan sinkronisasi: ${code}`
  }
}

export function pushStatus(
  watchExpiresAt: string | null,
  pushConfigured: boolean,
  now: Date = new Date(),
): { label: string; tone: 'success' | 'warning' } {
  if (!pushConfigured) return { label: 'Push mati — hanya tarikan 15 menit', tone: 'warning' }
  if (!watchExpiresAt || new Date(watchExpiresAt).getTime() <= now.getTime()) {
    return { label: 'Push belum aktif — menunggu sinkronisasi berikutnya', tone: 'warning' }
  }
  return { label: 'Push aktif', tone: 'success' }
}

const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }) : '—'

export function MailAccountsPanel() {
  const [accounts, setAccounts] = useState<MailAccountView[] | null>(null)
  const [pushConfigured, setPushConfigured] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)

  async function load() {
    try {
      const data = await fetchJson<{ pushConfigured: boolean; items: MailAccountView[] }>('/api/mail-accounts')
      setAccounts(data.items)
      setPushConfigured(data.pushConfigured)
    } catch (e: unknown) {
      setError(e instanceof FetchJsonError ? e.message : 'Gagal memuat kotak surat')
    }
  }

  useEffect(() => {
    const outcome = new URLSearchParams(window.location.search).get('mail')
    if (outcome) setFlash(MAIL_FLASH[outcome] ?? null)
    void load()
  }, [])

  async function syncNow() {
    setSyncing(true)
    setError(null)
    try {
      await fetchJson('/api/email/sync', { method: 'POST' })
      await load()
    } catch (e: unknown) {
      setError(e instanceof FetchJsonError ? e.message : 'Gagal menyinkronkan')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <FormSection
      title="Kotak surat email"
      description="Kotak surat Google yang email masuknya tampil di Inbox. Balasan dari Inbox keluar dari alamat yang disurati pelanggan."
      actions={
        <Button type="button" variant="outline" size="sm" onClick={() => void syncNow()} disabled={syncing || !accounts?.length}>
          {syncing ? 'Menyinkronkan...' : 'Sinkron sekarang'}
        </Button>
      }
    >
      <div className="space-y-4">
        {flash && <p role="status" className="rounded-md border border-line bg-surface p-3 text-sm text-ink">{flash}</p>}
        {error && <FieldError className="text-sm">{error}</FieldError>}

        {accounts && accounts.length > 0 && (
          <TableContainer>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Alamat</TableHead>
                  <TableHead>Terakhir berhasil</TableHead>
                  <TableHead>Push</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.map((account) => {
                  const push = pushStatus(account.watchExpiresAt, pushConfigured)
                  const problem = describeSyncError(account.lastSyncError)
                  return (
                    <TableRow key={account.id}>
                      <TableCell>{account.emailAddress}</TableCell>
                      <TableCell className="text-sm text-ink-muted">{formatDate(account.lastSyncAt)}</TableCell>
                      <TableCell><Badge variant={push.tone}>{push.label}</Badge></TableCell>
                      <TableCell className="text-sm">
                        {problem ? <span className="text-danger">{problem}</span> : <Badge variant="success">Sehat</Badge>}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}

        {accounts && accounts.length === 0 && (
          <p className="text-sm text-ink-muted">Belum ada kotak surat tersambung.</p>
        )}

        {/* Tautan biasa, bukan fetch: OAuth adalah navigasi penuh ke Google dan kembali. */}
        <a
          href="/api/mail-accounts/oauth/start"
          // Kelas yang sama dengan varian `default` Button (src/components/ui/button.tsx): ini
          // aksi utama panel, tapi harus berupa tautan karena OAuth adalah navigasi penuh.
          className="inline-flex h-8 items-center rounded-md bg-accent px-3 text-base font-medium text-white hover:bg-accent-hover"
        >
          Sambungkan kotak surat
        </a>
        <p className="text-xs text-ink-muted">
          Menyambungkan ulang alamat yang sudah ada memperbarui aksesnya tanpa kehilangan riwayat.
        </p>
      </div>
    </FormSection>
  )
}
```

Terverifikasi 2026-09-28: varian `success`/`warning` ada di `src/components/ui/badge.tsx`; `text-danger`, `bg-accent`, `hover:bg-accent-hover` dipakai di repo. Jangan menambah token warna baru. Kalau `className` pada `<a>` di atas dianggap komentar JSX tidak sah oleh eslint karena posisi komentarnya, pindahkan komentar itu ke atas elemen `<a>`.

Di `src/app/(authenticated)/settings/page.tsx`:

1. Import: `import { MailAccountsPanel } from '@/components/settings/MailAccountsPanel'`.
2. `type SettingsSectionId = ... | 'api-client'` → tambah `| 'kotak-surat'`.
3. Di `SETTINGS_SECTIONS`, setelah baris `{ id: 'api-client', label: 'API client', adminOnly: true },` tambahkan `{ id: 'kotak-surat', label: 'Kotak surat email', adminOnly: true },`.
4. Tepat di bawah `{activeId === 'api-client' && <ApiClientsPanel />}` tambahkan `{activeId === 'kotak-surat' && <MailAccountsPanel />}`.
5. Callback OAuth mendarat di `/settings?section=kotak-surat&mail=...`, jadi bagian aktif harus bisa dibuka dari URL. Di dekat `const [active, setActive] = useState<SettingsSectionId>('jalur')`, tambahkan:

```tsx
  // Callback OAuth kotak surat mendarat di ?section=kotak-surat -- tanpa ini admin kembali
  // dari Google ke bagian pertama dan tidak melihat hasil penyambungannya.
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('section')
    if (requested && SETTINGS_SECTIONS.some((s) => s.id === requested)) setActive(requested as SettingsSectionId)
  }, [])
```

(`useEffect` sudah diimpor di file itu; kalau belum, tambahkan ke import `react`.)

- [ ] **Step 4: Jalankan test, pastikan LULUS**

Run: `npx vitest run src/components/settings "src/app/(authenticated)/settings" && npx tsc --noEmit && npx eslint src/components/settings "src/app/(authenticated)/settings"`
Expected: PASS, exit 0. `page.test.tsx` yang sudah ada tetap hijau.

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/MailAccountsPanel.tsx src/components/settings/MailAccountsPanel.test.tsx "src/app/(authenticated)/settings/page.tsx"
git commit -m "feat(email): panel Kotak surat email di Pengaturan"
```

---

## Task 10: Inbox sadar-email + lepas sakelar bot Email (D1)

**Files:**
- Modify: `src/app/api/conversations/route.ts`, `src/app/api/conversations/[id]/route.ts` (+ test masing-masing)
- Modify: `src/components/inbox/ConversationListItem.tsx` (+ test)
- Modify: `src/components/inbox/ThreadView.tsx` (+ test)
- Modify: `src/app/(authenticated)/chatbot/page.tsx`
- Modify: `src/app/api/bot/channel-toggle/route.ts` (+ test)

**Interfaces:**
- Produces: `GET /api/conversations` item memuat `subject: string | null`; `GET /api/conversations/[id]` memuat `platform: Platform | null` dan `subject: string | null`. `ConversationListItem` menerima `subject?: string | null` (opsional, supaya fixture lama tetap berlaku).

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan ke `src/components/inbox/ConversationListItem.test.tsx`:

```tsx
  it('percakapan email menampilkan subjek di depan cuplikan dan TIDAK menampilkan ikon bot', () => {
    render(
      <ConversationListItem
        conversation={{ ...summary, platform: 'EMAIL', subject: 'Tur Bromo 3D2N', lastMessage: 'Masih ada slot?', botEnabled: false }}
        onClick={() => {}}
      />
    )
    expect(screen.getByText(/Tur Bromo 3D2N/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Bot mati')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Bot aktif')).not.toBeInTheDocument()
  })

  it('percakapan non-email tetap menampilkan ikon bot', () => {
    render(<ConversationListItem conversation={{ ...summary, platform: 'WHATSAPP' }} onClick={() => {}} />)
    expect(screen.getByLabelText('Bot aktif')).toBeInTheDocument()
  })
```

Tambahkan ke `src/components/inbox/ThreadView.test.tsx`, mengikuti pola `vi.mocked(fetch).mockImplementation` yang sudah dipakai file itu. Props `ThreadView` sama dengan test lain di file itu; kalau ada prop wajib selain `conversationId`, isi seperti test lain.

```tsx
  it('percakapan email: subjek tampil di header dan tombol bot tidak ada', async () => {
    vi.mocked(fetch).mockImplementation((url) => {
      const s = String(url)
      if (s.endsWith('/messages')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response)
      if (s.endsWith('/api/accounts')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response)
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ botEnabled: false, platform: 'EMAIL', subject: 'Tur Bromo 3D2N', contactName: 'Sinta' }),
      } as Response)
    })

    render(<ThreadView conversationId="conv_mail" />)

    await waitFor(() => expect(screen.getByText('Tur Bromo 3D2N')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /Ambil Alih dari Bot|Aktifkan Bot untuk Chat Ini/ })).not.toBeInTheDocument()
  })
```

Tambahkan ke `src/app/api/conversations/[id]/route.test.ts`:

```ts
  it('mengembalikan platform dan subjek untuk percakapan email', async () => {
    mockPrisma.conversation.findUniqueOrThrow.mockResolvedValue({
      botEnabled: false, isTest: false, bookingData: null, tripBrief: null, subject: 'Tur Bromo',
      channelIdentity: { platform: 'EMAIL' },
      contact: { id: 'c1', name: 'Sinta', avatarUrl: null, source: null },
      labels: [], pipelineStage: 'new', assignedAgentId: null, lastReadAt: null,
    } as never)
    vi.mocked(ensureFreshBookingData).mockResolvedValue(null as never)

    const res = await GET(new Request('http://localhost/api/conversations/conv_1'), { params: Promise.resolve({ id: 'conv_1' }) })
    expect(await res.json()).toMatchObject({ platform: 'EMAIL', subject: 'Tur Bromo' })
  })
```

Di test `src/app/api/bot/channel-toggle/route.test.ts` (atau buat file itu kalau belum ada, dengan mock `@/lib/db` dan `@/lib/auth/require-admin` mengikuti test route admin lain), tambahkan:

```ts
  it('EMAIL ditolak: bot tidak pernah menjawab email (draf manual saja)', async () => {
    const res = await POST(new Request('http://localhost/api/bot/channel-toggle', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ platform: 'EMAIL' }),
    }))
    expect(res.status).toBe(400)
    expect(mockPrisma.settings.update).not.toHaveBeenCalled()
  })
```

- [ ] **Step 2: Jalankan, pastikan GAGAL**

Run: `npx vitest run src/components/inbox/ConversationListItem.test.tsx src/components/inbox/ThreadView.test.tsx "src/app/api/conversations/[id]/route.test.ts" src/app/api/bot/channel-toggle`
Expected: FAIL.

- [ ] **Step 3: Implementasi**

`src/app/api/conversations/route.ts` — di objek yang dikembalikan `conversations.map(...)`, tepat setelah `platform: c.channelIdentity?.platform ?? null,` tambahkan:

```ts
    // Hanya terisi untuk EMAIL: subjek benang, ditampilkan di depan cuplikan pesan terakhir.
    subject: c.subject,
```

`src/app/api/conversations/[id]/route.ts` — ubah `include` menjadi `include: { contact: true, labels: { include: { label: true } }, channelIdentity: { select: { platform: true } } }`, lalu tambahkan dua field ke `NextResponse.json({...})`:

```ts
    platform: conversation.channelIdentity?.platform ?? null,
    subject: conversation.subject,
```

`src/components/inbox/ConversationListItem.tsx`:
1. Di tipe props percakapan, setelah `platform: Platform | null`, tambahkan:

```ts
  // Hanya untuk EMAIL. Opsional supaya pemanggil lama dan fixture test tetap berlaku.
  subject?: string | null
```

2. Ganti `const preview = isHandoffLog ? HANDOFF_LOG_SUMMARY : conversation.lastMessage` menjadi:

```ts
  const rawPreview = isHandoffLog ? HANDOFF_LOG_SUMMARY : conversation.lastMessage
  // Email: subjek lebih bermakna daripada kalimat pertama balasan ("Terima kasih, ...").
  const isEmail = conversation.platform === 'EMAIL'
  const preview = isEmail && conversation.subject ? `${conversation.subject} — ${rawPreview ?? ''}` : rawPreview
```

3. Bungkus `<span aria-label={conversation.botEnabled ? 'Bot aktif' : 'Bot mati'} ...>...</span>` dengan `{!isEmail && ( ... )}`. Bot tidak pernah menjawab email (D1), jadi ikon bot di baris email hanya bisa menyesatkan.

`src/components/inbox/ThreadView.tsx`:
1. Tipe `ConversationDetail`: tambahkan `platform?: string | null` dan `subject?: string | null`.
2. State baru di dekat `const [isTest, setIsTest] = useState(false)`:

```ts
  const [isEmail, setIsEmail] = useState(false)
  const [subject, setSubject] = useState<string | null>(null)
```

3. Di `.then((data) => { ... })` pemuat detail, setelah `setIsTest(data.isTest ?? false)`:

```ts
        setIsEmail(data.platform === 'EMAIL')
        setSubject(data.subject ?? null)
```

4. Di header, tepat setelah `<MarqueeText ... />` nama kontak (sebelum blok `{isTest && (...)}`):

```tsx
          {isEmail && subject && <span className="truncate text-xs text-ink-muted">{subject}</span>}
```

5. Bungkus tombol `{botEnabled ? 'Ambil Alih dari Bot' : 'Aktifkan Bot untuk Chat Ini'}` beserta `<Button>`-nya dengan `{!isEmail && ( ... )}`.

`src/app/(authenticated)/chatbot/page.tsx`:
1. Hapus baris `EMAIL: { label: 'Email', key: 'botEnabledEmail' },` dari `PLATFORM_LABELS`, dan ubah komentar di atasnya jadi `/** Sakelar bot per platform ... Email sengaja tidak ada: bot tidak pernah menjawab email (draf manual saja) -- lihat docs/superpowers/plans/2026-09-28-omnichannel-email.md, D1. */`.
2. Di bawah `<div className="mt-3 space-y-2">...</div>` daftar sakelar per channel, tambahkan:

```tsx
                <p className="mt-2 text-xs text-ink-muted">
                  Email tidak punya sakelar: bot tidak pernah membalas email otomatis. Pakai tombol draf di Inbox.
                </p>
```

3. Kalau `botEnabledEmail: boolean` di tipe settings halaman itu lalu tidak dipakai dan `eslint`/`tsc` mengeluh, hapus dari tipenya. Kolom database-nya tetap ada.

`src/app/api/bot/channel-toggle/route.ts`: ubah `platform: z.enum(['WHATSAPP', 'INSTAGRAM', 'FACEBOOK', 'EMAIL']),` menjadi:

```ts
  // EMAIL sengaja tidak diterima: bot tidak pernah menjawab email (draf manual saja, D1 di
  // docs/superpowers/plans/2026-09-28-omnichannel-email.md). Sakelar yang menyala tanpa
  // mengubah apa pun lebih buruk daripada tidak ada sakelar.
  platform: z.enum(['WHATSAPP', 'INSTAGRAM', 'FACEBOOK']),
```

`const platform: Platform = parsed.data.platform` tetap sah karena subset `Platform` bisa di-assign ke `Platform`.

- [ ] **Step 4: Jalankan seluruh suite**

Run: `npm test && npx tsc --noEmit && npx eslint . && node docs/superpowers/specs/check-omnichannel-design.mjs`
Expected: semua hijau.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/conversations src/components/inbox "src/app/(authenticated)/chatbot/page.tsx" src/app/api/bot/channel-toggle
git commit -m "feat(email): subjek email di Inbox, tanpa kontrol bot untuk email"
```

---

## Task 11: Deploy tahap 1 (tanpa tab) + konfigurasi Google + uji ujung-ke-ujung

Tugas ini **bukan kode**. Sebagian langkahnya dikerjakan operator di Google Cloud Console. Tab Email **belum** menyala di sini. Percakapan email sudah terlihat di tab "Semua" dan bisa dibuka untuk diuji, tapi tab khususnya menunggu Tugas 12.

**Prasyarat:** env Google (Step 3) siap. Kotak surat yang disambungkan: `hello@javavolcano-touroperator.com` dan `javavolcanotouroperator@gmail.com`.

- [ ] **Step 1: Sinkron dan build lokal**

```bash
git fetch --all && git status -sb   # harus "## main...origin/main" tanpa ahead/behind selain commit rencana ini
npm test && npx tsc --noEmit && npx eslint . && npm run build
```

Expected: semuanya exit 0. **Build gagal = berhenti**, jangan push.

- [ ] **Step 2: Konfigurasi Google Cloud (operator)**

Di proyek Google Cloud milik JVTO (buat baru kalau belum ada):

1. Aktifkan **Gmail API** dan **Cloud Pub/Sub API**.
2. **OAuth consent screen:** tipe **External** (wajib, karena `javavolcanotouroperator@gmail.com` di luar Workspace), lalu setel ke **In production**, bukan Testing (refresh token app Testing mati dalam 7 hari). Tambahkan scope `gmail.readonly` dan `gmail.send`. Catat apa yang konsol katakan tentang verifikasi untuk scope restricted, dan laporkan ke operator sebelum lanjut.
3. **Credentials → OAuth client ID → Web application.** Authorized redirect URI: `<APP_BASE_URL produksi>/api/mail-accounts/oauth/callback`, persis sama, tanpa garis miring ganda.
4. **Pub/Sub:**

```bash
gcloud pubsub topics create wa-inbox-gmail
gcloud pubsub topics add-iam-policy-binding wa-inbox-gmail \
  --member=serviceAccount:gmail-api-push@system.gserviceaccount.com --role=roles/pubsub.publisher
# TOKEN = string acak ≥ 24 karakter, mis. `openssl rand -base64 36 | tr -d '/+='`
gcloud pubsub subscriptions create wa-inbox-gmail-push --topic=wa-inbox-gmail \
  --push-endpoint="<APP_BASE_URL produksi>/api/webhooks/gmail?token=<TOKEN>" --ack-deadline=30
```

- [ ] **Step 3: Env produksi**

Tambahkan ke `/var/www/wa-inbox/.env` di VPS. **Jangan pernah menampilkan nilainya di terminal log atau di chat:**

```
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
GMAIL_PUBSUB_TOPIC=projects/<project-id>/topics/wa-inbox-gmail
GMAIL_PUSH_TOKEN=<TOKEN yang sama dengan langkah 2>
```

`APP_BASE_URL` dan `OUTBOUND_CRON_SECRET` sudah ada. Cukup pastikan keberadaannya, jangan cetak nilainya.

- [ ] **Step 4: Push, migrasi aditif, deploy kode**

Urutan CLAUDE.md §7: cadangkan → migrasi aditif → deploy kode → verifikasi sehat.

```bash
git push origin main
ssh <vps> 'export PATH="$HOME/.nvm/versions/node/<v22>/bin:$PATH" && cd /var/www/wa-inbox \
  && pg_dump "$DATABASE_URL" -t "\"Conversation\"" -t "\"Settings\"" -Fc -f ~/backup-pre-email-$(date +%Y%m%d%H%M).dump \
  && git fetch origin && git checkout origin/main -- . \
  && npx prisma migrate deploy && npm ci && npm run build && pm2 restart wa-inbox'
```

Sesuaikan path Node 22 dan nama proses pm2 dengan yang tercatat di memori deploy (`project_wa_inbox_vps_deploy`, `project_vps_node_version_deploy`). Jangan menebak. **Jangan** rsync `--delete` (`catalog/deployment-approval.json`).

- [ ] **Step 5: Smoke test**

```bash
curl -sI <APP_BASE_URL produksi>/login | head -1                                   # 200
curl -s -o /dev/null -w '%{http_code}\n' -X POST <APP_BASE_URL>/api/webhooks/gmail  # 403 (tanpa token)
```

- [ ] **Step 6: Crontab 15 menit**

Di VPS, salin bentuk baris crontab `daily-summary` yang sudah ada (host dan cara membaca secret), lalu tambahkan:

```
*/15 * * * * curl -fsS --max-time 300 -X POST -H "x-cron-secret: <sama dengan baris daily-summary>" <APP_BASE_URL>/api/email/sync > /dev/null
```

- [ ] **Step 7: Sambungkan kotak surat dan uji dengan akun sendiri**

1. Admin membuka Pengaturan → Kotak surat email → **Sambungkan kotak surat**, lalu mengulanginya untuk kotak surat kedua. Panel harus menampilkan "Kotak surat tersambung" dan "Push aktif" (setelah sinkronisasi pertama).
2. Dari kotak surat **milik sendiri** (bukan pelanggan), kirim email ke `hello@`. Dalam beberapa detik email itu muncul di tab **Semua** dengan badge Email dan subjeknya.
3. Balas dari Inbox. Email harus tiba di kotak surat pengirim **dalam thread yang sama**, dari `hello@`, dan balasan itu ada di folder Sent Gmail `hello@`. Di Inbox balasan itu hanya muncul **sekali**.
4. Balas sekali lagi dari kotak surat pengirim dengan kutipan otomatis. Di Inbox hanya balasan barunya yang terlihat, tanpa riwayat kutipan.
5. Tekan "Generate draf" pada pesan email itu. Drafnya menjawab email terakhir, bukan yang pertama.
6. `curl -s -X POST -H "x-cron-secret: ..." <APP_BASE_URL>/api/email/sync` → JSON `results` dengan `error: null` untuk kedua kotak surat.

**Kalau ada langkah yang gagal, BERHENTI.** Tab Email tidak dinyalakan (Tugas 12) sampai semua langkah di atas lulus.

---

## Task 12: Nyalakan tab Email + perbarui dokumen

**Files:**
- Modify: `src/lib/channel/platform.ts`, `src/lib/channel/platform.test.ts`
- Modify: `docs/superpowers/specs/check-omnichannel-design.mjs`
- Modify: `docs/superpowers/specs/2026-09-23-omnichannel-inbox-design.md` (baris status + §9)
- Modify: `CLAUDE.md` (§4)

- [ ] **Step 1: Ubah harapan test**

Di `src/lib/channel/platform.test.ts`, ubah harapan `SHIPPED_PLATFORMS` menjadi `['WHATSAPP', 'FACEBOOK', 'INSTAGRAM', 'EMAIL']`.

Run: `npx vitest run src/lib/channel/platform.test.ts`
Expected: FAIL.

- [ ] **Step 2: Nyalakan tab**

Di `src/lib/channel/platform.ts`:

```ts
export const SHIPPED_PLATFORMS = ['WHATSAPP', 'FACEBOOK', 'INSTAGRAM', 'EMAIL'] as const satisfies readonly Platform[]
```

Ganti kalimat komentar "Karena itu Email TIDAK ada di sini sampai fasenya benar-benar selesai." dengan:

```ts
 * Email masuk 2026-MM-DD (isi tanggal deploy), setelah uji ujung-ke-ujung di produksi: email
 * masuk lewat push, terbalas dari Inbox dalam thread yang sama, tanpa duplikat salinan SENT.
```

- [ ] **Step 3: Balik klaim pemeriksa spec**

Di `docs/superpowers/specs/check-omnichannel-design.mjs`:
1. Ganti `mustContain('src/lib/channel/platform.ts', /SHIPPED_PLATFORMS = \['WHATSAPP', 'FACEBOOK', 'INSTAGRAM'\]/, 'INSTAGRAM di SHIPPED_PLATFORMS')` menjadi:

```js
mustContain('src/lib/channel/platform.ts', /SHIPPED_PLATFORMS = \['WHATSAPP', 'FACEBOOK', 'INSTAGRAM', 'EMAIL'\]/, 'INSTAGRAM dan EMAIL di SHIPPED_PLATFORMS')
```

2. Hapus baris `mustNotContain('src/lib/channel/platform.ts', /SHIPPED_PLATFORMS = \[[^\]]*EMAIL/, 'EMAIL di SHIPPED_PLATFORMS (fase email, belum)')` beserta komentar "Email BELUM" di atasnya.
3. Ganti komentar `// §6.3 — belum ada infrastruktur email sama sekali.` dengan `// §6.3 — infrastruktur email hidup di src/lib/gmail/, TIDAK di inbound.ts/send.ts: keduanya hanya mendelegasikan, tanpa SDK email.` Loop `mustNotContain` di bawahnya tetap.
4. Tambahkan:

```js
// §6.3 — dua lapis masuk: push + tarikan cron yang sekaligus memperpanjang watch().
fileExists('src/app/api/webhooks/gmail/route.ts')
mustContain('src/middleware.ts', /'\/api\/email\/sync'/, 'sinkronisasi email sebagai jalur cron')
mustContain('src/lib/gmail/sync.ts', /renewWatchIfDue/, 'perpanjangan watch() di jalur sinkronisasi')
// §2 / §11 — bot TIDAK menjawab email: percakapan email lahir dengan bot mati, dan sakelarnya tidak diterima.
mustContain('src/lib/gmail/ingest.ts', /botEnabled: false/, 'percakapan email lahir tanpa bot')
mustNotContain('src/app/api/bot/channel-toggle/route.ts', /z\.enum\(\[[^\]]*'EMAIL'/, 'sakelar bot EMAIL')
```

Run: `node docs/superpowers/specs/check-omnichannel-design.mjs`
Expected: exit 0.

- [ ] **Step 4: Perbarui spec dan CLAUDE.md**

Di spec `2026-09-23-omnichannel-inbox-design.md`:
- Baris status → `**Status:** fondasi, sakelar per channel, Facebook, Instagram, dan Email (fase 3) tayang. Fase 3b (pelabel) belum.`
- Di §9 Fase 3, tambahkan paragraf: `**SELESAI <tanggal>** lewat docs/superpowers/plans/2026-09-28-omnichannel-email.md. Menyimpang dari §1/§2 dengan sengaja: sakelar bot Email dilepas (keputusan D1 rencana itu), karena bot tidak pernah menjawab email dan sakelar tanpa efek dilarang §5.`

Di `CLAUDE.md` §4, tambahkan subbagian setelah "### Outbound":

```markdown
### Email (Gmail)
`MailAccount` (satu baris per kotak surat JVTO, disambungkan lewat OAuth di Pengaturan → Kotak
surat email). `refreshToken` **tidak pernah** keluar ke UI/API/log. Satu thread Gmail = satu
`Conversation` (`externalThreadId` = threadId, `mailAccountId` = kotak surat yang disurati;
balasan keluar dari alamat itu). Masuk lewat dua lapis: push Pub/Sub `POST /api/webhooks/gmail`
(bel pintu, token di query) dan crontab VPS `*/15` `POST /api/email/sync` yang **sekaligus
memperpanjang `watch()`** (mati tiap 7 hari). **Bot tidak pernah menjawab email** — draf manual
saja; tidak ada sakelar bot Email. Kode di `src/lib/gmail/`.
```

- [ ] **Step 5: Suite penuh, build, commit, deploy**

```bash
npm test && npx tsc --noEmit && npx eslint . && npm run build
git add src/lib/channel docs/superpowers/specs CLAUDE.md
git commit -m "feat(email): nyalakan tab Email di Inbox"
git push origin main
```

Deploy ke VPS seperti Tugas 11 Step 4, tapi **tanpa** `pg_dump` dan migrasi (tidak ada perubahan skema). Lalu `curl -sI <APP_BASE_URL>/login` → 200. Buka Inbox: tab **Email** tampil di sebelah Instagram dan berisi benang uji dari Tugas 11.

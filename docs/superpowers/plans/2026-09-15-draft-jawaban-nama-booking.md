# Draft Jawaban per Pesan & Nama Booking — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Satu task = satu implementer.

**Goal:**
1. Di setiap pesan teks dari pelanggan ada tombol **Generate draft**. Bot menyusun jawaban untuk pesan itu dengan riwayat chat SEBELUM pesan itu dan konteks booking pelanggan, tanpa mengirim apa pun. Draft tampil seperti jawaban bot (alasan bot + peringatan gap knowledge), bisa **Generate ulang**, **Edit draft**, dan **Kirim pesan** (terkirim sebagai quote ke pesan yang dipilih). Status "Sudah diedit" dan "Terkirim ke pelanggan" terlihat oleh semua agen.
2. Nama dari data booking tampil sebagai nama tambahan: `Zayar (Muhammad Zayar)` di daftar inbox, header chat, dan panel kontak. Nama yang terlalu panjang dipotong `…`, dan saat di-hover bergulir (marquee) menampilkan seluruh nama. Kartu booking di panel kanan menampilkan nama pemesan dan kode booking.

**Keputusan operator (mengikat):**
- Catatan trip (`Conversation.tripBrief`) yang dipakai adalah catatan TERAKHIR, bukan snapshot per pesan.
- Gap knowledge dari draft hanya TAMPIL di draft. Baru ditulis ke `KnowledgeGapLog` (daftar gap + lonceng) saat draft DIKIRIM, sama seperti balasan bot sungguhan.
- Satu pesan punya satu draft aktif. Generate ulang boleh selama belum terkirim. Setelah terkirim, draft terkunci.
- Pesan terkirim sebagai balasan (quote) ke pesan yang dipilih.
- Panel "Uji Bot" per chat sudah dihapus (commit pertama branch ini).
- Tombol hanya muncul di pesan masuk yang berisi teks.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Prisma 7 (PostgreSQL), Zod, Vitest + Testing Library + vitest-mock-extended, lucide-react, Tailwind v4.

**Direktori kerja:** `/Users/macbook/Code/wa-inbox` (branch `feat/draft-jawaban-nama-booking`). Baca `CLAUDE.md` dan `.claude/rules/*.md` sebelum mulai.

## Global Constraints

- Tanpa `any`: pakai `unknown` + penyempitan tipe.
- Setiap route mutasi: `getSession` (401 `{ error: 'Tidak terautentikasi' }`) → validasi Zod (400) → `try-catch`; galat selalu `{ error: string }` dengan status HTTP yang sesuai, tanpa membocorkan pesan error mentah.
- Tanpa dependensi npm baru.
- DILARANG `npx prisma migrate dev` dan DILARANG `npx prisma migrate deploy` (`DATABASE_URL` = produksi). Migrasi hanya dibuat sebagai file SQL aditif; controller yang menerapkannya.
- DILARANG deploy, push, atau menyentuh VPS.
- Mode draft TIDAK BOLEH memanggil `sendMessage`, membuat `OutboundJob`, menulis `Conversation.tripBrief`, atau menulis `KnowledgeGapLog`. Hanya aksi "Kirim pesan" yang mengirim.
- Test simulator yang membuktikan simulator tidak memanggil `sendMessage` / membuat `OutboundJob` harus tetap hijau.
- Perilaku bot di jalur normal (non-draft) tidak berubah sama sekali; semua test orchestrator yang ada tetap hijau tanpa diubah ekspektasinya.
- Tanpa module-level mutable state / AsyncLocalStorage untuk mode draft: opsi diteruskan eksplisit lewat parameter.
- Komponen `'use client'` tidak boleh mengimpor (walau hanya satu simbol nilai) dari modul yang menjangkau prisma/pg; tipe bersama untuk client ditaruh di modul tanpa dependensi server. Build produksi pernah mati karena ini.
- Teks UI dalam Bahasa Indonesia; kode & identifier dalam Inggris; komentar mengikuti gaya sekitar.
- Gerbang per task: `npx vitest run <berkas test yang disentuh task itu>` + `npx tsc --noEmit` + `npx eslint <berkas yang disentuh>` (0 error).
- Commit dengan path eksplisit (tanpa `git add -A`/`.`), pesan berbahasa Indonesia gaya `fix(inbox): ...`/`feat(inbox): ...`, diakhiri trailer `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

## Peta Berkas

| Berkas | Task |
|---|---|
| `src/lib/bot/orchestrator.ts`, `src/lib/bot/orchestrator.test.ts` | 1 |
| `prisma/schema.prisma`, `prisma/migrations/20260915090000_message_draft/migration.sql` | 2 |
| `src/lib/inbox/message-draft-view.ts` (tipe, tanpa dependensi server) | 3 |
| `src/lib/inbox/message-draft.ts` + test | 3 |
| `src/app/api/conversations/[id]/messages/[messageId]/draft/route.ts` + test | 3 |
| `src/app/api/conversations/[id]/messages/[messageId]/draft/send/route.ts` + test | 3 |
| `src/lib/serialize-message.ts`, `src/app/api/conversations/[id]/messages/route.ts` + test | 4 |
| `src/lib/inbox/gap-labels.ts`, `src/components/inbox/MessageDraftCard.tsx` + test, `src/components/inbox/MessageBubble.tsx` + test, `src/components/inbox/ThreadView.tsx` + test | 5 |
| `src/lib/booking/display-name.ts` + test, `src/components/ui/marquee-text.tsx` + test, `src/app/globals.css` (keyframes), `src/app/api/conversations/route.ts` + test, `src/components/inbox/ConversationListItem.tsx`/`ConversationList.tsx` + test, `src/components/inbox/ThreadView.tsx`, `src/components/inbox/ContactPanel.tsx`, `src/components/contacts/BookingSummary.tsx` + test, `src/lib/booking/client.ts` (tipe) | 6 |

---

### Task 1: Mode draft di `decideAndRespond`

**Tujuan:** engine bot yang sama bisa dijalankan untuk satu pesan lama di percakapan asli tanpa efek samping ke data percakapan.

**Antarmuka (ekspor dari `src/lib/bot/orchestrator.ts`):**

```ts
export type PendingKnowledgeGap = {
  topic: string
  reason: 'no_facts_resolved' | 'verification_failed'
  messageText: string
}

export type DecisionRunOptions = {
  /**
   * Draft jawaban dari Inbox: riwayat dipotong sebelum pesan yang dipilih, dan tidak ada
   * tulisan ke tripBrief maupun KnowledgeGapLog. Gap yang biasanya ditulis dikumpulkan ke
   * `knowledgeGaps` supaya bisa ditulis nanti, saat draftnya benar-benar dikirim.
   */
  draft?: { historyBefore: Date; knowledgeGaps: PendingKnowledgeGap[] }
}

export async function decideAndRespond(
  conversationId: string,
  inboundText: string,
  pipeline: PipelineTracer = createNoopPipelineTracer(),
  options: DecisionRunOptions = {}
): Promise<BotDecision>
```

**Perilaku saat `options.draft` ada:**
1. `fetchRecentHistory` (ketiga pemanggilnya: jalur booking/Mode 3, `runNoDestinationBranch`, jalur utama) menambahkan `createdAt: { lt: historyBefore }` ke `where`. Tanpa draft, argumen `prisma.message.findMany` HARUS identik dengan sekarang (ada test yang mencocokkan argumennya persis).
2. `persistTripBrief` tetap menggabungkan `nextTripBrief` di memori (pembacaan di giliran yang sama tetap melihat perubahan), tetapi TIDAK memanggil `prisma.$executeRaw`.
3. Ketiga pemanggilan `recordKnowledgeGap` (`verification_failed` di `composeVerifiedReply`, `no_facts_resolved` di `runNoDestinationBranch` dan di jalur utama) mendorong `{ topic, reason, messageText }` ke `options.draft.knowledgeGaps` alih-alih menulis `prisma.knowledgeGapLog.create`. Teruskan lewat parameter eksplisit ke fungsi-fungsi pembantu yang perlu (mis. field baru pada params `composeVerifiedReply`, parameter baru pada `runNoDestinationBranch`/`runBookingContextMode`). Tanpa draft, penulisan tetap persis seperti sekarang.
4. Selain tiga hal di atas tidak ada yang berubah (pencarian booking `ensureFreshBookingData` tetap jalan: konteks booking memang diinginkan).

**Test (tambahkan `describe('mode draft (generate draft dari Inbox)')` di `src/lib/bot/orchestrator.test.ts`, meniru setup test yang sudah ada):**
1. Skenario yang di jalur normal memanggil `$executeRaw` (lihat test yang sudah memeriksa `expect(mockPrisma.$executeRaw).toHaveBeenCalled()`): dengan `options.draft`, `$executeRaw` tidak dipanggil dan keputusannya tetap dihasilkan.
2. Dengan `options.draft`, `prisma.message.findMany` dipanggil dengan `where: { conversationId, content: { not: null }, createdAt: { lt: historyBefore } }` (sisa argumen sama dengan jalur normal).
3. Skenario yang di jalur normal menulis `knowledgeGapLog.create` dengan `reason: 'no_facts_resolved'` (cari test yang sudah ada): dengan `options.draft`, `knowledgeGapLog.create` tidak dipanggil dan `knowledgeGaps` berisi `{ topic, reason: 'no_facts_resolved', messageText }`.
4. Kalau ada test yang sudah memicu `verification_failed`, tambahkan padanan draft-nya dengan pola yang sama.

TDD: tulis test dulu, pastikan gagal, baru implementasi.

---

### Task 2: Skema `MessageDraft` + migrasi aditif

Tambahkan ke `prisma/schema.prisma` (dengan komentar `///` berbahasa Indonesia yang menjelaskan: dibuat agen dari Inbox 2026-09-15, satu draft aktif per pesan lewat `sourceMessageId @unique`, terkunci setelah `sentAt` terisi, id akun disimpan sebagai string biasa):

```prisma
model MessageDraft {
  id                   String       @id @default(cuid())
  conversationId       String
  conversation         Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  sourceMessageId      String       @unique
  sourceMessage        Message      @relation("MessageDraftSource", fields: [sourceMessageId], references: [id], onDelete: Cascade)
  generatedText        String?
  text                 String?
  decision             Json
  pendingKnowledgeGaps Json?
  decisionRunId        String?
  generatedById        String?
  generatedAt          DateTime     @default(now())
  editedById           String?
  editedAt             DateTime?
  sentById             String?
  sentAt               DateTime?
  sentMessageId        String?      @unique
  createdAt            DateTime     @default(now())
  updatedAt            DateTime     @updatedAt

  @@index([conversationId])
}
```

Relasi balik: di `Conversation` tambah `messageDrafts MessageDraft[]`; di `Message` tambah `draft MessageDraft? @relation("MessageDraftSource")`.

Migrasi `prisma/migrations/20260915090000_message_draft/migration.sql`: buat lewat `prisma migrate diff` dari skema lama (`git show HEAD:prisma/schema.prisma` ke file sementara di luar repo) ke `prisma/schema.prisma` dengan output `--script` (cek `npx prisma migrate diff --help` untuk nama flag Prisma 7). SQL hanya boleh berisi `CREATE TABLE`, `CREATE UNIQUE INDEX`/`CREATE INDEX`, dan `ADD CONSTRAINT ... FOREIGN KEY`. Tidak ada `DROP`, `ALTER COLUMN`, atau perubahan tabel lain.

Lalu `npx prisma generate`, `npx prisma validate`, `npx tsc --noEmit`, dan `npx vitest run "src/app/api/conversations/[id]/clear"` (hapus chat test menghapus pesan; FK cascade tidak boleh membuatnya gagal).

---

### Task 3: Layanan draft + route API

**Tipe bersama untuk client** `src/lib/inbox/message-draft-view.ts` (tanpa impor apa pun selain `import type`):

```ts
export type DraftKnowledgeGap = { reason: string; missingQuestion: string | null }

export type MessageDraftView = {
  id: string
  sourceMessageId: string
  text: string | null
  generatedText: string | null
  mode: 'faq' | 'booking_context' | 'clarify' | 'handoff'
  handoffReason: string | null
  /** BotDecision yang sudah disanitasi, untuk BotTracePopover. */
  decision: unknown
  knowledgeGaps: DraftKnowledgeGap[]
  generatedAt: string
  generatedByName: string | null
  editedAt: string | null
  editedByName: string | null
  sentAt: string | null
  sentByName: string | null
  sentMessageId: string | null
}
```

**Layanan** `src/lib/inbox/message-draft.ts`:

```ts
export class DraftError extends Error {
  constructor(readonly status: 400 | 404 | 409, message: string)
}
export async function generateDraft(input: { conversationId: string; messageId: string; accountId: string }): Promise<MessageDraftView>
export async function editDraft(input: { conversationId: string; messageId: string; accountId: string; text: string }): Promise<MessageDraftView>
export async function sendDraft(input: { conversationId: string; messageId: string; accountId: string }): Promise<{ draft: MessageDraftView; message: MessageView }>
/** Untuk route daftar pesan (Task 4). */
export async function draftsForConversation(conversationId: string): Promise<{ bySourceMessageId: Map<string, MessageDraftView>; sentMessageIds: Set<string> }>
```

Aturan (pesan galat persis):
- Pesan sumber dicari berdasarkan `messageId`; tidak ada atau `conversationId` beda → `DraftError(404, 'Pesan tidak ditemukan di percakapan ini')`.
- Bukan `INBOUND` atau `content` kosong setelah trim → `DraftError(400, 'Draft hanya bisa dibuat untuk pesan teks dari pelanggan')`.
- **generateDraft:** draft yang sudah `sentAt` → `DraftError(409, 'Draft sudah terkirim dan terkunci')`. Jalankan `decideAndRespond(conversationId, source.content, undefined, { draft: { historyBefore: source.createdAt, knowledgeGaps } })`, catat `recordBotDecisionRun({ conversationId, inboundText: source.content, decision, startedAt, finishedAt, simulated: true })`, teks = `replyFromDecision(decision)` (dari `@/lib/bot-control/simulator`), `decision` disimpan lewat `sanitizeTrace` (`@/lib/bot-control/trace-sanitizer`). Simpan dengan penjaga balapan: `updateMany({ where: { sourceMessageId, sentAt: null }, data })`; kalau `count === 0` dan belum ada baris → `create`; kalau `create` gagal karena unique (P2002) → ulangi `updateMany` sekali; kalau tetap 0 → 409 di atas. Generate (ulang) mengosongkan `editedAt`/`editedById` dan menyamakan `text` dengan `generatedText`. TIDAK PERNAH memanggil `sendMessage` dan TIDAK PERNAH menulis `KnowledgeGapLog`.
- **editDraft:** belum ada draft → `DraftError(404, 'Draft belum dibuat')`; sudah terkirim → 409 `'Draft sudah terkirim dan terkunci'`. `editedAt`/`editedById` diisi hanya kalau `text !== generatedText`, selain itu dikosongkan. Update memakai penjaga `sentAt: null`.
- **sendDraft:** belum ada → 404 `'Draft belum dibuat'`; sudah terkirim → 409; `text` kosong setelah trim → `DraftError(400, 'Draft kosong, tulis jawabannya dulu')`. Klaim dulu: `updateMany({ where: { id, sentAt: null }, data: { sentAt: now, sentById: accountId } })`, `count === 0` → 409. Lalu `sendMessage({ conversationId, text, sentBy: 'AGENT', agentId: accountId, replyToId: sourceMessageId, botTrace: draft.decision })`. Kalau `sendMessage` melempar: kembalikan klaim (`sentAt: null, sentById: null`) lalu lempar ulang. Setelah terkirim: simpan `sentMessageId`, `attachMessageToDecisionRun(decisionRunId, sent.id)`, tulis setiap `pendingKnowledgeGaps` ke `prisma.knowledgeGapLog.create({ data: { conversationId, topic, reason, messageText } })` masing-masing dalam try/catch sendiri, lalu `recordUnsourcedReplyGap({ decision, conversationId, messageId: sent.id, runId: decisionRunId, inboundText: source.content })` (kegagalannya dicatat, tidak menggagalkan pengiriman). Kembalikan draft + pesan terkirim yang diserialisasi `serializeMessage` (ambil ulang dengan `include: { replyTo: true }`).
- **View:** `knowledgeGaps` = `knowledgeGapsForDecision(decision, source.content)` dipetakan ke `{ reason, missingQuestion }` ditambah setiap `pendingKnowledgeGaps` sebagai `{ reason, missingQuestion: null }`. `handoffReason` = `decision.reason` untuk mode handoff, selain itu null. Nama akun diambil sekali per panggilan lewat `prisma.account.findMany({ where: { id: { in } }, select: { id: true, name: true } })`.

**Route:**
- `src/app/api/conversations/[id]/messages/[messageId]/draft/route.ts`: `POST` → `generateDraft`; `PATCH` body `z.object({ text: z.string().max(4096) }).strict()` dan teks kosong setelah trim → 400 `'Draft tidak boleh kosong'` → `editDraft`.
- `src/app/api/conversations/[id]/messages/[messageId]/draft/send/route.ts`: `POST` → `sendDraft`.
- Params divalidasi `z.object({ id: z.string().trim().min(1), messageId: z.string().trim().min(1) })` (400 `'Alamat pesan tidak valid'`). `DraftError` → status + `{ error }`. Galat lain → 500 `'Gagal membuat draft'` / `'Gagal menyimpan draft'` / `'Gagal mengirim draft'`. Terbuka untuk semua yang login (komentar: sama seperti `/api/send`, pekerjaan harian agen, tidak mengubah perilaku bot, jadi tanpa audit log).

**Test:** unit test layanan (mock `@/lib/db` dengan `mockDeep<PrismaClient>`, mock `decideAndRespond`, `recordBotDecisionRun`, `attachMessageToDecisionRun`, `sendMessage`, `recordUnsourcedReplyGap`): generate memanggil engine dengan opsi draft yang benar, mencatat run `simulated: true`, tidak memanggil `sendMessage` maupun `knowledgeGapLog.create`; generate ulang pada draft terkirim → 409; pesan bukan teks/outbound → 400; pesan dari percakapan lain → 404; edit mengisi/mengosongkan `editedAt` sesuai aturan; edit draft terkirim → 409; send memanggil `sendMessage` dengan `sentBy: 'AGENT'`, `replyToId` = pesan sumber, `botTrace` = decision; send menulis pending gap dan memanggil `recordUnsourcedReplyGap` dengan id pesan terkirim; send kedua kali → 409; `sendMessage` melempar → klaim dikembalikan. Test route: 401 tanpa sesi (layanan tidak dipanggil), 400 Zod, `DraftError` diteruskan dengan statusnya, jalur sukses.

---

### Task 4: Daftar pesan membawa draft

- `serializeMessage(m, knowledgeGap = null, extras: { draft?: MessageDraftView | null; fromDraft?: boolean } = {})` menambah field `draft: extras.draft ?? null` dan `fromDraft: extras.fromDraft ?? false` pada `MessageView` (`src/lib/serialize-message.ts`). Pemanggil lain tidak perlu diubah.
- `GET /api/conversations/[id]/messages` memanggil `draftsForConversation(id)` sekali, lalu melampirkan `draft` ke pesan sumbernya dan `fromDraft: true` ke pesan yang id-nya ada di `sentMessageIds`.
- Test route: pesan masuk mendapat `draft`-nya; pesan terkirim dari draft mendapat `fromDraft: true`; pesan lain `draft: null`, `fromDraft: false`.

---

### Task 5: Tampilan draft di Inbox

- **`src/lib/inbox/gap-labels.ts`:** pindahkan `KNOWLEDGE_GAP_LABEL` dan `knowledgeGapLabel(reason)` dari `MessageBubble.tsx` ke sini (tanpa dependensi); `MessageBubble` mengimpornya. Label tidak berubah.
- **`MessageView` di `MessageBubble.tsx`** tambah `draft?: MessageDraftView | null` dan `fromDraft?: boolean`.
- **Tombol Generate draft** (di `MessageBubble`): tampil hanya untuk `direction === 'INBOUND'`, `content` tidak kosong, `conversationId` tersedia, dan belum ada draft. Label `Generate draft`; saat berjalan `Menyusun draft...` dan nonaktif. Galat tampil sebagai teks `text-danger` di bawahnya.
- **`src/components/inbox/MessageDraftCard.tsx`** (dirender di bawah gelembung pesan sumber, lebar maksimum sama dengan gelembung):
  - Judul `Draft jawaban bot` dengan ikon bot.
  - Status: belum terkirim → badge `Belum terkirim`; `editedAt` → badge `Sudah diedit` + `oleh {editedByName}` bila ada; terkirim → badge `Terkirim ke pelanggan` + `oleh {sentByName} · {jam:menit}`.
  - Isi: `text` diformat `formatWhatsAppText`. Kalau `text` kosong dan mode handoff: `Bot memilih menyerahkan ke agen: {handoffReason}. Tulis jawabannya lewat Edit draft.`
  - Gap: kalau `knowledgeGaps.length > 0`, kartu bergaris warning (sama seperti gelembung bot ber-gap: `border-warning ring-1 ring-warning/30`) dan daftar peringatan, tiap baris `knowledgeGapLabel(reason)` diikuti pertanyaan `missingQuestion` dalam tanda kutip bila ada.
  - Tombol ikon `Lihat alasan bot` membuka `BotTracePopover` dengan `trace={draft.decision as BotDecision}`.
  - Belum terkirim: tombol `Generate ulang` (POST `/api/conversations/{conversationId}/messages/{messageId}/draft`), `Edit draft` (membuka `Textarea` berisi teks, tombol `Simpan` → PATCH endpoint yang sama dengan `{ text }`, dan `Batal`), `Kirim pesan` (POST `.../draft/send`, nonaktif saat teks kosong atau sedang mengedit). Selama satu permintaan berjalan semua tombol nonaktif. Galat tampil `text-danger`.
  - Terkirim: tanpa tombol aksi (terkunci).
  - Semua panggilan lewat `fetchJson`.
- **`MessageBubble`** menerima `onDraftChange?: (messageId: string, draft: MessageDraftView) => void` dan `onDraftSent?: (messageId: string, draft: MessageDraftView, sent: MessageView) => void`, diteruskan ke kartu.
- **Pesan terkirim dari draft** (`fromDraft === true`, `sentBy: 'AGENT'`): diperlakukan seperti balasan bot untuk tombol alasan bot, indikator gap, dan `FixAnswerPanel`; ditambah badge `Dari draft bot`. Tombol salin tetap hanya untuk `BOT`.
- **`ThreadView`:** `onDraftChange` mengganti `draft` pada pesan sumber; `onDraftSent` mengganti `draft` pada pesan sumber dan meng-upsert pesan terkirim (ganti berdasarkan id kalau sudah masuk lewat SSE, selain itu tambahkan). Handler SSE `message.created`/`message.updated` mempertahankan `draft` dan `fromDraft` yang sudah ada kalau payload event tidak membawanya.
- **Test:** `MessageDraftCard.test.tsx` (teks + status belum terkirim; peringatan gap; handoff tanpa teks; edit → PATCH lalu `onDraftChange`; kirim → POST send lalu `onDraftSent`; terkirim → tanpa tombol aksi dan badge terkirim), `MessageBubble.test.tsx` (tombol Generate draft hanya pada pesan masuk berteks dengan `conversationId`; tidak pada pesan keluar/media; generate → POST lalu `onDraftChange`; `fromDraft` menampilkan badge dan tombol alasan bot), `ThreadView.test.tsx` (SSE `message.updated` tanpa `draft` tidak menghapus draft yang sudah tampil).

---

### Task 6: Nama booking + marquee + kartu booking

- **`src/lib/booking/display-name.ts`:**
  - `bookingGuestName(bookingData: unknown): string | null`: `guest` bertipe string yang tidak kosong setelah trim, selain itu null.
  - `contactDisplayName(contactName: string | null, guestName: string | null, fallback: string): string`: `base = contactName?.trim() || fallback`; kalau `guestName` ada dan `guestName.trim().toLowerCase() !== base.toLowerCase()` → `` `${base} (${guestName.trim()})` ``, selain itu `base`.
- **`GET /api/conversations`** menambah `bookingGuestName: bookingGuestName(c.bookingData)`; `ConversationSummary` menambah `bookingGuestName: string | null`. `ConversationList` mempertahankan `bookingGuestName` yang sudah ada saat menggabungkan event SSE yang tidak membawanya.
- **`src/components/ui/marquee-text.tsx`** (`'use client'`): `MarqueeText({ text, className })` merender satu baris terpotong `…` (`truncate`) dengan `title={text}`. Saat hover atau fokus, kalau isinya melebihi lebar (`scrollWidth > clientWidth`), teks bergulir horizontal sampai ujung dan kembali (keyframes di `src/app/globals.css`, jarak lewat CSS variable), lalu kembali terpotong saat hover selesai. Dengan `prefers-reduced-motion: reduce` tidak bergulir (tetap `title`).
- **Pemakaian:** nama di `ConversationListItem` (`contactDisplayName(contactName, bookingGuestName, contactPhone)`), header `ThreadView` dan `ContactPanel` (`contactDisplayName(contactName, bookingGuestName(bookingData), 'Tanpa nama')`), semuanya lewat `MarqueeText`. Kelas tebal/ukuran yang sudah ada dipertahankan.
- **`BookingSummary`** (booking terkonfirmasi): tiga baris baru di urutan paling atas daftar, masing-masing hanya kalau ada: `Nama` = `guest`, `Kode booking` = `id`, `Nomor booking` = `booking_number`. Tambahkan `booking_number?: string` ke `BookingData` di `src/lib/booking/client.ts`.
- **Test:** unit `display-name` (nama sama beda huruf besar → sekali; tanpa nama kontak → fallback + nama booking; guest kosong → base); `marquee-text` (render teks + `title`); route `GET /api/conversations` membawa `bookingGuestName`; `ConversationListItem` menampilkan `Zayar (Muhammad Zayar)`; `BookingSummary` menampilkan Nama, Kode booking, Nomor booking.

---

### Task 7: Gerbang akhir (controller)

`npm test`, `npx tsc --noEmit`, `npx eslint .` (0 error), `npm run build`. Terapkan migrasi ke produksi dengan `npx prisma migrate deploy` SEBELUM kode dideploy (aditif, aman untuk kode lama). Merge ke `main`, push, deploy VPS dengan restart hanya bila build sukses, smoke test.

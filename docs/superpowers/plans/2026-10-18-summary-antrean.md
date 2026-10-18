# Plan: Summary Harian → Antrean tindakan

Spec: `docs/superpowers/specs/2026-10-18-summary-antrean-design.md`
Branch: `feat/summary-antrean`

## Global Constraints

- Bahasa komentar & teks UI: Indonesia, gaya sama dengan file sekitarnya (komentar kepala file menjelaskan *kenapa*).
- Dilarang `any` (pakai `unknown`/tipe yang tepat). Zod v4 (`zod@^4`).
- **Dilarang** `npx prisma migrate dev` / `db push` / perintah Prisma apa pun yang menyentuh database — `DATABASE_URL` menunjuk produksi. Hanya `npx prisma generate` dan `npx prisma migrate diff --from-schema … --to-schema … --script` (offline).
- Test memakai mock prisma (`vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))`, pola `src/lib/daily-summary/collect-db.test.ts`). Tidak ada test yang menulis ke DB sungguhan.
- Error response `{ error: string }`, `try/catch` di setiap handler, tidak membocorkan pesan error mentah.
- Mutasi: auth `getSession(req)` (401 bila null). Body divalidasi Zod. Tidak menulis `BotControlAuditLog`.
- Item state persis: `OPEN | SCHEDULED | DONE | DROPPED`. Kind persis: `REPLY | FOLLOW_UP`. closedReason persis: `REPLIED | REMINDER_DONE | DROPPED`.
- Sebelum selesai setiap task: `npm test` (atau minimal file test terkait + suite yang tersentuh), `npx tsc --noEmit`, `npx eslint .` (0 error).
- Jangan ubah bentuk `dailySummaryPayloadSchema`.

---

## Task 1: Model `SummaryItem`, migrasi, sinkronisasi & rekonsiliasi

**Files:** `prisma/schema.prisma`, `prisma/migrations/20261018100000_summary_items/migration.sql`, baru `src/lib/summary-items/sync.ts` (+ `sync.test.ts`), `src/lib/daily-summary/generate.ts`, `src/app/api/outbound-jobs/process/route.ts`.

### Skema
Tambahkan (dengan komentar `///` gaya `DailySummary`):

```prisma
model SummaryItem {
  id              String       @id @default(cuid())
  conversationId  String       @unique
  conversation    Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  /// REPLY | FOLLOW_UP
  kind            String
  /// OPEN | SCHEDULED | DONE | DROPPED
  state           String
  /// Waktu pesan pemicu. REPLY tertutup oleh pesan OUTBOUND sesudahnya; FOLLOW_UP jadi REPLY oleh INBOUND sesudahnya.
  anchorAt        DateTime
  anchorMessageId String?
  snippet         String
  /// ConversationReview (payload-schema.ts) terakhir, atau null bila LLM gagal.
  review          Json?
  handoff         Boolean      @default(false)
  newLead         Boolean      @default(false)
  /// "YYYY-MM-DD" ringkasan yang (kembali) membuka item ini.
  openedOn        String
  /// "YYYY-MM-DD" ringkasan terakhir yang memuat item ini.
  lastSeenOn      String
  reminderId      String?
  dueAt           DateTime?
  /// REPLIED | REMINDER_DONE | DROPPED
  closedReason    String?
  note            String?
  closedById      String?
  closedAt        DateTime?
  createdAt       DateTime     @default(now())
  updatedAt       DateTime     @updatedAt

  @@index([state])
}
```
dan field balik `summaryItem SummaryItem?` di `model Conversation`.

Migrasi: simpan skema lama `git show HEAD:prisma/schema.prisma > <scratch>/old.prisma`, lalu `npx prisma migrate diff --from-schema <scratch>/old.prisma --to-schema prisma/schema.prisma --script > prisma/migrations/20261018100000_summary_items/migration.sql` (sesuaikan flag dengan Prisma 7 / `prisma.config.ts` bila perlu — tetap offline). SQL harus hanya `CREATE TABLE`, `CREATE INDEX`, `CREATE UNIQUE INDEX`, `ALTER TABLE … ADD CONSTRAINT … FOREIGN KEY`. Tidak boleh ada `DROP`. Jalankan `npx prisma generate`.

### `src/lib/summary-items/sync.ts`
Ekspor konstanta tipe `SUMMARY_ITEM_KINDS = ['REPLY','FOLLOW_UP'] as const`, `SUMMARY_ITEM_STATES = ['OPEN','SCHEDULED','DONE','DROPPED'] as const`.

**`syncSummaryItems(date: string, payload: DailySummaryPayload, now: Date = new Date()): Promise<{ created: number; updated: number; reopened: number }>`** — tidak pernah melempar (log + kembalikan nol).
Kandidat: setiap `payload.unreplied[i]` → kind `REPLY`; setiap `payload.dormant[i]` → kind `FOLLOW_UP`. Field: `anchorAt = new Date(item.lastMessageAt)`, `anchorMessageId = item.lastMessageId ?? null`, `snippet`, `review` (null → `Prisma.DbNull`), `handoff = payload.handoffs.some(h => h.conversationId === id)` (REPLY saja; FOLLOW_UP false), `newLead = payload.newLeads.some(l => l.conversationId === id)`.
Per kandidat, baca baris berdasarkan `conversationId`:
- tidak ada → `create` state `OPEN`, `openedOn = lastSeenOn = date`.
- state `OPEN`/`SCHEDULED` → update kind/anchor/snippet/review/handoff/newLead; `lastSeenOn = max(lastSeenOn, date)` (perbandingan string). State & openedOn tetap.
- state `DONE`/`DROPPED`: bila `anchorAt > closedAt` → buka ulang: state `OPEN`, semua field kandidat, `openedOn = lastSeenOn = date`, kosongkan `closedReason, note, closedById, closedAt, reminderId, dueAt`. Bila tidak → biarkan (keputusan operator/penutupan tetap berlaku untuk pesan yang sama).

**`reconcileSummaryItems(now: Date = new Date()): Promise<{ closed: number; converted: number; reopened: number }>`** — tidak pernah melempar. Untuk setiap item state `OPEN`/`SCHEDULED`:
1. Bila `FOLLOW_UP`: cari pesan INBOUND paling awal dengan `createdAt > anchorAt`. Bila ada → ubah jadi `kind REPLY`, `anchorAt`/`anchorMessageId` = pesan itu, `snippet = messageSnippet(pesan)` (dari `src/lib/daily-summary/collect.ts`), state → `OPEN`, reminder terkait (bila ada & belum done) ditandai `done: true`, `reminderId/dueAt` dikosongkan. Hitung `converted`. Lanjutkan ke langkah 2 dengan nilai baru.
2. Bila `REPLY`: ada pesan OUTBOUND dengan `createdAt > anchorAt` → state `DONE`, `closedReason 'REPLIED'`, `closedAt = now`; reminder terkait yang belum done → `done: true`. Hitung `closed`. Selesai untuk item ini.
3. Bila state `SCHEDULED`: reminder (`reminderId`) tidak ada → state `OPEN`, kosongkan reminderId/dueAt (`reopened`). Reminder `done` → state `DONE`, `closedReason 'REMINDER_DONE'`, `closedAt = now` (`closed`). Reminder `dueAt <= now` → state `OPEN` (pertahankan `reminderId`/`dueAt` supaya UI bisa bilang "pengingat jatuh tempo") (`reopened`).
Tulisan per item yang menyentuh item + reminder dibungkus `prisma.$transaction`.

**`pruneSummaryItems(now: Date = new Date()): Promise<{ deleted: number }>`** — hapus state `DONE`/`DROPPED` dengan `closedAt < now - RETENTION_MS` (`src/lib/daily-summary/config.ts`). Tidak pernah melempar.

### Wiring
- `generate.ts`: setelah `prisma.dailySummary.update` sukses (DONE/PARTIAL), panggil `await syncSummaryItems(date, payload)` lalu `await reconcileSummaryItems()`. Di `finally`, di samping `pruneDailySummaries(now)`, panggil `pruneSummaryItems(now)`. Kegagalan sinkronisasi tidak boleh mengubah status ringkasan.
- `outbound-jobs/process/route.ts`: tambah `await reconcileSummaryItems().catch(...)` mengikuti pola blok housekeeping yang ada, dengan komentar kenapa (item harus tertutup saat dibalas, bukan menunggu 00:00).
- Perbarui mock test yang ada bila wiring baru membuat test `generate.test.ts` / route process gagal (mock modul `@/lib/summary-items/sync`).

### Tests (`sync.test.ts`, mock prisma)
Minimal: create baru; update OPEN mempertahankan openedOn & menaikkan lastSeenOn; DONE dengan anchor lebih baru → dibuka ulang & field penutupan dikosongkan; DROPPED dengan anchor sama/lebih lama → tidak disentuh; reconcile REPLY + outbound sesudah anchor → DONE/REPLIED dan reminder ditandai done; FOLLOW_UP + inbound → REPLY dengan anchor inbound; FOLLOW_UP + inbound + outbound sesudahnya → DONE; SCHEDULED + reminder done → DONE/REMINDER_DONE; SCHEDULED + dueAt lewat → OPEN; prune memakai batas 30 hari; sync/reconcile menelan error (prisma melempar → tidak melempar).

---

## Task 2: API antrean

**Files:** baru `src/app/api/summary-items/route.ts`, `src/app/api/summary-items/count/route.ts`, `src/app/api/summary-items/[id]/schedule/route.ts`, `src/app/api/summary-items/[id]/drop/route.ts`, `src/lib/summary-items/view.ts`, + test `route.test.ts` masing-masing (pola `src/app/api/daily-summary/route.test.ts`).

Dari Task 1 tersedia: model `SummaryItem`, `reconcileSummaryItems()` di `@/lib/summary-items/sync`.

**`view.ts`**: tipe `SummaryItemView = { id, conversationId, contactName: string|null, pipelineStage: string, kind: 'REPLY'|'FOLLOW_UP', state: 'OPEN'|'SCHEDULED', anchorAt: string, anchorMessageId: string|null, snippet: string, review: ConversationReview|null, handoff: boolean, newLead: boolean, openedOn: string, dueAt: string|null }` dan `toSummaryItemView(row)` — `review` di-`conversationReviewSchema.safeParse`, gagal → null.

**GET `/api/summary-items`** — `getSession` (401). `await reconcileSummaryItems()`. Ambil state `OPEN` + `SCHEDULED` dengan `conversation: { select: { pipelineStage, contact: { select: { name } } } }`. Urutan: OPEN dulu (REPLY sebelum FOLLOW_UP, lalu `anchorAt` naik), lalu SCHEDULED (`dueAt` naik). Response `{ open: SummaryItemView[], scheduled: SummaryItemView[], openGapTotal: number }`, `openGapTotal` = `knowledgeGapLog.count({ where: { resolvedAt: null, conversation: { isTest: false } } })`.

**GET `/api/summary-items/count`** — `getSession` (401). `{ open: number }` = count state `OPEN`. Tanpa reconcile (dipanggil berkala oleh menu).

**POST `/api/summary-items/[id]/schedule`** — body `{ dueAt: string (ISO datetime), note: string }`; `note` di-trim, 1–500 karakter; `dueAt` harus > sekarang dan ≤ sekarang + 90 hari (400 kalau tidak). Item tidak ada → 404; state bukan OPEN/SCHEDULED → 409. Dalam `$transaction`: bila item punya `reminderId` yang reminder-nya ada & belum done → update `dueAt`/`note` reminder itu; selain itu buat `Reminder { contactId: conversation.contactId, dueAt, note }`. Update item `state SCHEDULED`, `reminderId`, `dueAt`. Response `SummaryItemView`.

**POST `/api/summary-items/[id]/drop`** — body `{ note?: string }` (trim, ≤500, kosong → null). 404/409 seperti di atas. Dalam `$transaction`: item `state DROPPED`, `closedReason 'DROPPED'`, `note`, `closedById = session.accountId`, `closedAt = now`; reminder terkait yang belum done → `done: true`. Response `{ ok: true }`.

Tests: 401 tanpa sesi; urutan & bentuk GET; count; schedule membuat reminder baru vs. memperbarui yang ada; validasi dueAt (lampau, >90 hari) & note kosong → 400; 404; 409 untuk DONE; drop menyimpan closedById & menandai reminder done; error prisma → 500 `{ error }`.

---

## Task 3: Halaman antrean + angka di menu

**Files:** `src/app/(authenticated)/summary/page.tsx` (tulis ulang), `src/components/daily-summary/SummarySections.tsx` (ganti isi / hapus yang tak terpakai), baru `src/components/daily-summary/SummaryQueue.tsx` (+ test), `src/components/AppRail.tsx` (+ sesuaikan `AppRail.test.tsx`).

Dari Task 2: `GET /api/summary-items` → `{ open, scheduled, openGapTotal }`, `GET /api/summary-items/count` → `{ open }`, `POST …/[id]/schedule {dueAt, note}`, `POST …/[id]/drop {note?}`, tipe `SummaryItemView` di `@/lib/summary-items/view`.

**Halaman `/summary`:**
- `PageHeader` judul "Summary Harian", deskripsi "Antrean tindakan dari ringkasan chat harian. Item selesai saat dibalas, dijadwalkan, atau dilepas."
- Tetap: tombol admin "Buat ulang" / "Buat ringkasan kemarin" + baris status ringkasan terbaru (tanggal, status, model, peringatan RUNNING/PARTIAL/error) dari `GET /api/daily-summary` yang sudah ada (tanpa `date` = terbaru). Setelah buat ulang selesai, muat ulang antrean juga.
- Dibuang: pemilih tanggal, 6 tab, 4 kartu `Stat`.
- Baris "{openGapTotal} gap knowledge terbuka →" tautan ke `/settings/knowledge-gaps`, hanya bila > 0.
- `SummaryQueue`: daftar item OPEN, lalu grup "Dijadwalkan (N)" (tertutup/terbuka lewat `<details>`), empty state "Tidak ada item terbuka. Semua sudah dibalas, dijadwalkan, atau dilepas."

**Kartu item OPEN:** nama kontak (tautan Inbox), badge jenis ("Belum dibalas" untuk REPLY, "Follow up" untuk FOLLOW_UP), badge "Handoff" bila `handoff`, "Lead baru" bila `newLead`, "Pengingat jatuh tempo" bila `dueAt` terisi; label stage (`STAGE_LABELS` dari `@/lib/pipeline`); waktu: REPLY "menunggu {formatWait}" / FOLLOW_UP "diam {formatWait}" dihitung dari `anchorAt` ke jam sekarang (`formatWait` dari `@/components/dashboard/data`); "sejak {tanggal openedOn}"; snippet; review: topik, `alasan → langkahBerikut`, atau badge "Belum dicek LLM". Aksi:
- Tautan utama "Balas" (REPLY, dengan `&message=anchorMessageId`) / "Follow up" (FOLLOW_UP) ke `/inbox?conversation=…`.
- Tombol "Ingatkan": panel inline dengan pilihan "Besok 09.00", "3 hari", "7 hari" (pukul 09.00 WIB, hitung tanggal kalender Asia/Jakarta, kirim ISO dengan offset `+07:00`), textarea catatan berisi awal `review.langkahBerikut` atau `Follow up {nama}`, tombol "Jadwalkan" → POST schedule.
- Tombol "Lepas": panel inline textarea "Catatan (opsional)" + tombol "Lepas item" → POST drop.
- Setelah aksi sukses: muat ulang daftar dan `window.dispatchEvent(new Event('summary-items:changed'))`. Gagal: pesan error inline di kartu.

**Kartu SCHEDULED:** nama, jenis, "diingatkan {tanggal/jam dueAt WIB}", tautan Inbox.

**`SummarySections.tsx`:** cari semua pemakai setiap ekspornya (`grep -rn` seluruh `src`) sebelum menghapus. Hapus yang tidak lagi dipakai; pindahkan helper yang masih berguna (mis. `ReviewLine`, `conversationHref`) ke `SummaryQueue.tsx` atau biarkan diekspor bila dipakai.

**AppRail:** angka item OPEN di item navigasi `/summary` (desktop sidebar dan sidebar "Semua" di ponsel — ikuti cara render `NAV_ITEMS`), diambil dari `GET /api/summary-items/count` saat mount, setiap 60 detik, dan saat event `summary-items:changed`. Kegagalan fetch ditelan (pola GapBell). Angka 0 tidak ditampilkan. `aria-label` tautan menyebut jumlahnya.

Tests: `SummaryQueue.test.tsx` (render item OPEN & SCHEDULED, badge, tautan Balas dengan message, panel Ingatkan mengirim POST dengan dueAt 09:00+07:00 & note awal = langkahBerikut, Lepas mengirim POST, empty state); AppRail menampilkan angka dari endpoint count (mock fetch) dan tidak menampilkan 0. Jalankan juga `npm run build` di akhir task ini (exit 0).

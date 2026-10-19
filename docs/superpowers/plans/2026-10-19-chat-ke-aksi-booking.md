# Chat → Aksi Booking — Rencana Implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Setiap pesan tamu yang berarti perubahan atau ketidaksesuaian booking langsung jadi kartu tindakan di wa-inbox. Siapa pun yang login memutuskan dengan satu klik, dan setiap kejadian tercatat.

**Architecture:** Panggilan LLM ekstraksi terpisah dipicu dari `ingestSingleMessage` (tidak menunggu dan tidak bergantung pada `botEnabled`). Hasilnya disimpan sebagai `BookingFact` dan `BookingAction`. Perbandingan fakta ↔ `bookingData` adalah kode murni yang dijalankan ulang setiap kali `bookingData` disegarkan. Semua kejadian ditulis append-only ke `BookingActionEvent`. Penerapan lewat jalur my-booking legacy yang hidup hanya bila env-nya diisi.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Prisma 7, PostgreSQL, Zod, Vitest, Ollama (`callLLM`).

**Spec:** `docs/superpowers/specs/2026-10-19-chat-ke-aksi-booking-design.md`

## Global Constraints

- Ikuti `CLAUDE.md`: tanpa `any`, error `{ error: string }`, try-catch di setiap handler, migrasi sesuai §7 (`migrate diff` + `migrate deploy`; **jangan** `migrate dev` ke DB produksi).
- Mutasi booking-action **terbuka untuk semua akun yang login** (keputusan owner 2026-10-19). Ini pengecualian dari `hasAdminPowers()` dan wajib ditulis di §6 CLAUDE.md (Task 12).
- Ke LLM hanya dikirim field: `pickup`, `dropoff`, `date`, `total_pax`, `hotels[].{day,checkIn,hotel}`, `tshirtSize`. **Tidak pernah** `financial`, `expense`, `paymentHistory`, atau `guestDetails`.
- Ekstraksi tidak boleh memperlambat atau menggagalkan balasan bot. Tidak di-await di jalur webhook, dan seluruh isinya dibungkus try/catch (pola `tracer.ts`).
- Kolom teks bebas dari model/admin (`reason`, `note`) lewat `sanitizeTrace` saat **tulis**.
- Mobile-first: setiap komponen baru diuji pada lebar 360 px. Tombol aksi minimal 44 px tinggi, satu kolom.
- PWA + Web Push ke admin untuk setiap kejadian aksi booking (spec §5.10, Task 8b).
- Test hanya ke nomor whitelist `6282143403501` / percakapan `isTest`.
- Pembagian persis seperti spec §5.3: `AI` (titik/jam/detail di Surabaya, kaos, catatan), `BALI` (booking dengan transport Bali: AI ubah + kabari vendor), `HEAVY` (pindah Surabaya ↔ Bali, tanggal, pax, hotel). Contoh owner (Surabaya Airport → Surabaya Hotel) = `AI`.
- Setiap permintaan perubahan, kelompok apa pun, wajib: push ke admin, tercatat, dan label "Permintaan perubahan · belum dipenuhi" sampai ditutup (spec §5.3a). Tidak ada kedaluwarsa.
- Draf permintaan data: mulai **H-7**, **setiap hari** sampai lengkap atau trip mulai, maksimal satu draf terbuka per booking per hari WIB.

## Review Focus

1. **Booking yang dituju berganti di tengah jalan.** Kalau `bookingData.booking_id` berubah antara kartu dibuat dan Eksekusi diklik, eksekusi ditolak 409 dan kartu meminta admin memeriksa ulang. Kode booking dan tanggal trip selalu tampil di kartu (test di Task 10).
2. **Jam kosong dari backoffice.** `pickup_time` dibentuk `date("H:i", strtotime(null))` dan bisa berisi jam palsu. Pembanding tidak boleh memunculkan peringatan jam bila booking tidak punya jam asli (test di Task 3).
3. **Tamu mengoreksi dirinya sendiri** ("eh maaf, bukan 5 tapi 4"). Fakta terbaru menggantikan fakta lama, dan peringatan yang bersandar pada fakta lama tertutup (test di Task 4).
4. **Booking diubah langsung di backoffice** sebelum ada yang klik. Kartu tertutup "sudah sesuai di backoffice" pada tick berikutnya, tanpa LLM (test di Task 4).
5. **LLM mengembalikan JSON rusak/sebagian/nilai ngawur** (titik pickup yang tidak dikenal, pax 0). Item cacat dibuang satu per satu, sisanya tetap dipakai (test di Task 2).

---

## Struktur file

```
prisma/schema.prisma                                 + BookingFact, BookingAction, BookingActionEvent
src/lib/booking-actions/fields.ts                    registry field: key, tier, cara baca dari BookingData, normalisasi
src/lib/booking-actions/extract.ts                   prompt + callLLM + parse Zod → Extraction
src/lib/booking-actions/compare.ts                   murni: fakta × booking → ketidaksesuaian; usulan × booking → sudah sesuai?
src/lib/booking-actions/store.ts                     tulis Extraction, reevaluate(conversationId), riwayat
src/lib/booking-actions/history.ts                   recordEvent() — satu-satunya penulis BookingActionEvent
src/lib/booking-actions/schedule.ts                  pemicu dari inbound (debounce per percakapan, gerbang)
src/lib/booking-actions/impact.ts                    dampak perubahan berat (baca internal-api saat tampil)
src/lib/booking-actions/data-requests.ts             draf H-7 harian
src/lib/booking/backoffice-client.ts                 klien ber-token: daftar booking per HP, tulis perubahan
src/app/api/conversations/[id]/booking-actions/route.ts   GET daftar + riwayat
src/app/api/booking-actions/[id]/route.ts                 PATCH tolak / tutup / eksekusi
src/components/inbox/BookingActionsSection.tsx       kartu di ContactPanel (mobile-first)
src/components/inbox/BookingHistoryList.tsx          riwayat per booking
src/components/daily-summary/SummaryQueue.tsx        + bagian "Booking"
```

---

## Fase 1 — Jalan tanpa perubahan backoffice

### Task 1: Skema + riwayat

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20261020100000_booking_actions/migration.sql`
- Create: `src/lib/booking-actions/history.ts`, test `history.test.ts`

**Interfaces — Produces:**

```prisma
model BookingFact {
  id              String   @id @default(cuid())
  conversationId  String
  conversation    Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  bookingId       String?          // booking_id backoffice dari bookingData saat dibuat
  field           String           // FieldKey (fields.ts)
  value           String
  sourceMessageId String?
  statedAt        DateTime
  supersededAt    DateTime?
  createdAt       DateTime @default(now())
  @@index([conversationId, field])
}

model BookingAction {
  id              String   @id @default(cuid())
  conversationId  String
  conversation    Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  bookingId       String?
  /// CHANGE | MISMATCH | TASK | DATA_REQUEST
  type            String
  field           String
  /// ChangeGroup: AI | BALI | HEAVY
  tier            String
  proposedValue   Json?            // CHANGE/TASK: nilai yang diminta; MISMATCH: fakta chat
  draftText       String?          // DATA_REQUEST
  /// OPEN | EXECUTED | REJECTED | SUPERSEDED | RESOLVED | DONE | FAILED
  state           String
  /// mis. MATCHED_IN_BACKOFFICE | DISMISSED_CHAT_WRONG | REPLACED | DATA_COMPLETE | TRIP_STARTED | MARKED_DONE | NOT_NEEDED
  closedReason    String?
  sourceMessageId String?
  forDay          String?          // DATA_REQUEST: "YYYY-MM-DD" WIB
  lastError       String?
  closedById      String?
  closedAt        DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  @@index([conversationId, state])
  @@unique([bookingId, type, forDay])   // satu DATA_REQUEST per booking per hari
}

model BookingActionEvent {
  id             String   @id @default(cuid())
  conversationId String
  bookingId      String?
  actionId       String?
  /// CREATED | CORRECTED | EXECUTED | EXECUTE_FAILED | REJECTED | SUPERSEDED | RESOLVED | DRAFT_SENT | REVERTED
  event          String
  /// BOT | SYSTEM | ACCOUNT
  actor          String
  accountId      String?
  oldValue       Json?
  newValue       Json?
  sourceMessageId String?
  reason         String?
  backoffice     Json?            // jawaban backoffice saat EXECUTED/EXECUTE_FAILED (tanpa secret)
  createdAt      DateTime @default(now())
  @@index([bookingId, createdAt])
  @@index([conversationId, createdAt])
}
```

`recordEvent(tx: Prisma.TransactionClient | PrismaClient, e: BookingEventInput): Promise<void>`. Dengan client transaksi ia **melempar**, standalone **menelan + log** (pola `writeBotAuditLog`). `reason` lewat `sanitizeTrace`.

- [ ] **Step 1:** Test `history.test.ts`:
  - `recordEvent sanitizes reason` (reason berisi token Bearer → tersimpan tanpa token)
  - `recordEvent throws inside transaction`
  - `recordEvent swallows standalone`
- [ ] **Step 2:** `npx vitest run src/lib/booking-actions/history.test.ts`. Expected: FAIL (modul belum ada).
- [ ] **Step 3:** Tambah model. Buat migrasi:
  ```bash
  git show HEAD:prisma/schema.prisma > /tmp/old.prisma
  npx prisma migrate diff --from-schema /tmp/old.prisma --to-schema prisma/schema.prisma --script
  ```
  SQL harus **aditif saja** (CREATE TABLE, ADD COLUMN nullable). Implementasikan `history.ts`.
- [ ] **Step 4:** Test PASS. Jalankan `npx tsc --noEmit`.
- [ ] **Step 5:** Commit `feat(booking-actions): skema + riwayat`.

### Task 2: Registry field + ekstraktor

**Files:** Create `src/lib/booking-actions/fields.ts`, `extract.ts` (+ tests).

**Interfaces — Produces:**

```ts
export type FieldKey =
  | 'pickup_point' | 'pickup_detail' | 'pickup_arrival' | 'pickup_time'
  | 'drop_point' | 'drop_detail' | 'drop_arrival' | 'drop_time'
  | 'tshirt_sizes' | 'note' | 'travel_date' | 'total_pax' | 'hotel'
export type ChangeGroup = 'AI' | 'BALI' | 'HEAVY'
export const POINT_VALUES = ['Surabaya Airport','Denpasar Airport','Surabaya Train Station','Surabaya Hotel','Bali Hotel','Others'] as const
export function changeGroup(key: FieldKey, newValue: string, booking: BookingData): ChangeGroup
export function usesBaliTransport(booking: BookingData): boolean
export function readBookingField(b: BookingData, key: FieldKey): string | null   // null = tidak diketahui
export function normalizeFieldValue(key: FieldKey, raw: string): string | null   // null = nilai tidak sah

export type Extraction = {
  changes: Array<{ field: FieldKey; value: string; messageId: string }>
  facts:   Array<{ field: FieldKey; value: string; messageId: string }>
}
export async function extractBookingSignals(input: {
  transcript: NumberedTranscript; booking: BookingData
}): Promise<Extraction | null>          // null = gagal teknis
export function parseExtraction(raw: string, ids: readonly string[]): Extraction
export function bookingContextForLLM(b: BookingData): Record<string, unknown>
```

Pemetaan: `travel_date`/`total_pax`/`hotel` → HEAVY; `pickup_point`/`drop_point` dengan nilai baru atau lama `Denpasar Airport`/`Bali Hotel` → HEAVY (ganti paket); selain itu `BALI` bila `usesBaliTransport(booking)` (paket mulai Bali atau add-on transport Bali — builder memastikan field mana di `bookingData` yang menandainya), selain itu `AI`. Test: `Surabaya Airport → Surabaya Hotel is AI`, `Surabaya Hotel → Bali Hotel is HEAVY`, `drop_time on Bali-transport booking is BALI`. `readBookingField('pickup_detail')` membaca `pickup.meeting_point_value`; `'pickup_arrival'` membaca `meeting_point_arrival`; `'pickup_time'` membaca `pickup_time` (lihat Task 3 untuk jam palsu). Hal yang sama untuk drop (`drop_point*`, `drop_time`).

- [ ] **Step 1:** Test:
  - `parseExtraction drops unknown field and keeps the rest`
  - `parseExtraction drops pickup_point outside POINT_VALUES`
  - `parseExtraction drops total_pax "0" and "abc"`
  - `parseExtraction maps #N to messageId and drops invalid N` (pola `parseReview`)
  - `parseExtraction returns empty on non-JSON`
  - `bookingContextForLLM never includes financial/guestDetails` (assert `Object.keys` ⊆ whitelist dari Global Constraints)
  - `normalizeFieldValue('pickup_time','9 pagi') === '09:00'`
  - `normalizeFieldValue('pickup_time','jam sembilan') === null`
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementasi. `callLLM(prompt, { system, timeoutMs: 20_000 })` (opsi timeout sesuai `LLMOptions`). Transkrip memakai `buildNumberedTranscript` dari `src/lib/daily-summary/collect.ts`. Prompt menjelaskan beda `changes` (tamu **meminta** perubahan) dan `facts` (tamu **menyatakan** sesuatu tentang tripnya).
- [ ] **Step 4:** PASS. Tambah 4 golden case ke `npm run eval`: ganti pickup bandara→hotel, kirim nomor flight, "kami berlima", basa-basi tanpa sinyal.
- [ ] **Step 5:** Commit.

### Task 3: Pembanding (murni)

**Files:** Create `src/lib/booking-actions/compare.ts` (+ test).

**Interfaces — Produces:**

```ts
export type Mismatch = { field: FieldKey; chatValue: string; bookingValue: string | null; factId: string }
export function findMismatches(facts: ActiveFact[], booking: BookingData): Mismatch[]
export function changeAlreadyApplied(change: { field: FieldKey; value: string }, booking: BookingData): boolean
export function bookingTimeKnown(raw: string | undefined | null): boolean
```

`bookingTimeKnown` mengembalikan `false` untuk `null`, `''`, dan nilai jam palsu dari `strtotime(null)`. **Langkah pertama task ini:** pastikan nilai palsu itu dengan membaca 1 booking produksi yang jamnya kosong (baca-saja, sesuai memori izin DB). Tulis nilainya sebagai konstanta beserta komentar sumbernya.

- [ ] **Step 1:** Test:
  - `pax mismatch: fact 5 vs total_pax 4 → 1 mismatch`
  - `no mismatch when booking time unknown`
  - `flight number compare ignores case/spaces ("tr 296" == "TR296")`
  - `changeAlreadyApplied true when meeting_point_value equals proposed hotel (case-insensitive, trimmed)`
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit.

### Task 4: Store + reevaluate

**Files:** Create `src/lib/booking-actions/store.ts` (+ test).

**Interfaces — Consumes:** Task 1–3. **Produces:**

```ts
export async function applyExtraction(conversationId: string, ex: Extraction, now?: Date): Promise<{ created: number }>
export async function reevaluateBookingActions(conversationId: string, now?: Date): Promise<{ resolved: number; opened: number }>
```

Aturan:
- `CHANGE` untuk kelompok AI/BALI. HEAVY dari `changes` menjadi `TASK`. Setiap CHANGE/TASK baru memanggil `notifyBookingAction` (Task 8b) dan menyalakan label percakapan.
- Usulan baru untuk `field` yang sama menutup yang lama (`SUPERSEDED`, reason `REPLACED`).
- Fakta baru untuk `field` yang sama menstempel `supersededAt` fakta lama.
- `reevaluateBookingActions` membaca `bookingData` **terbaru**, lalu:
  - CHANGE/TASK yang `changeAlreadyApplied` → `RESOLVED` / `MATCHED_IN_BACKOFFICE`
  - MISMATCH yang tidak lagi muncul di `findMismatches` → `RESOLVED`
  - mismatch baru → MISMATCH `OPEN`

  Satu transaksi. Setiap transisi `recordEvent` dengan actor `SYSTEM` (atau `BOT` untuk CREATED dari ekstraksi). Sesudahnya `broadcast({ type: 'booking-actions.changed', conversationId })` (tambahkan varian ini ke `RealtimeEvent` di `src/lib/realtime.ts`).

- [ ] **Step 1:** Test:
  - `heavy change becomes TASK`
  - `second change same field supersedes first and records SUPERSEDED`
  - `self-correction: fact 5 then fact 4 with total_pax 4 → mismatch resolved`
  - `backoffice already updated → CHANGE resolved MATCHED_IN_BACKOFFICE without LLM` (mock `callLLM` dan assert tidak terpanggil)
  - `every transition writes exactly one BookingActionEvent`
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit.

### Task 5: Pemicu dari inbound + penyegaran

**Files:**
- Create: `src/lib/booking-actions/schedule.ts` (+ test)
- Modify: `src/lib/inbound.ts` (sesudah blok `if (conversation.botEnabled && botCanAnswer)`, ±baris 690)
- Modify: `src/lib/booking/client.ts` (`ensureFreshBookingData`, sesudah `prisma.conversation.update` saat `stale`)
- Modify: `src/lib/pipeline/steps.ts` (+ step `ekstrak-booking`)

**Interfaces — Produces:** `scheduleBookingExtraction(conversationId: string, tracer?: PipelineTracer): void`

- Debounce 8 s per percakapan.
- Gerbang:
  - **bukan** `isIndonesianNumber(contact.phone)` (`src/lib/phone.ts`), selalu, tanpa melihat setelan
  - `bookingData` ada
  - `date.end_ymd` ≥ hari ini (WIB)
  - teks bukan `isNoiseMessage`
- **Tidak** memeriksa `botEnabled`.
- Ambil 20 pesan terakhir, panggil `extractBookingSignals`, lalu `applyExtraction`, lalu `reevaluateBookingActions`.
- Gagal → `traceStep(tracer,'ekstrak-booking','gagal')` dan selesai.

Di `ensureFreshBookingData`: sesudah `bookingData` ditulis ulang, panggil `reevaluateBookingActions(conversation.id).catch(log)`.

- [ ] **Step 1:** Test:
  - `runs when botEnabled=false`
  - `skips Indonesian number even when skipBotForIndonesianNumbers=false`
  - `skips when trip ended`
  - `skips noise message`
  - `burst of 3 messages → one extraction`
  - `extractor throws → bot reply path unaffected` (di `inbound.test.ts`: `scheduleBotRun` tetap terpanggil)
  - `ensureFreshBookingData refresh triggers reevaluate`
- [ ] **Step 2–4:** FAIL → implement → PASS. Jalankan `npm test` penuh.
- [ ] **Step 5:** Commit.

### Task 6: Dampak perubahan berat

**Files:** Create `src/lib/booking-actions/impact.ts` (+ test). Env baru: `BACKOFFICE_INTERNAL_API_URL`, `BACKOFFICE_INTERNAL_API_TOKEN` (header `Authorization: Bearer`; ini `MCP_REPORT_TOKEN` di sisi backoffice).

**Interfaces — Produces:**

```ts
export type Impact = { crewClashes: string[]; hotelNights: string[]; medicalCheckupDate: { from: string | null; to: string | null } | null; unavailable?: true }
export async function computeImpact(action: { field: FieldKey; proposedValue: unknown; bookingId: string }): Promise<Impact>
```

Membaca `/internal-api/bookings/{id}` dan `/internal-api/medical-checkups` **saat ditampilkan** dan tidak pernah disimpan. Kalau gagal atau env kosong, kembalikan `{ unavailable: true, ... }` dan kartu menulis "dampak tidak bisa dihitung".

- [ ] Steps:
  - Test `date shift reports crew clash`
  - Test `api down → unavailable`
  - FAIL → implement → PASS → commit.

### Task 7: API baca + tutup/tolak

**Files:** Create `src/app/api/conversations/[id]/booking-actions/route.ts`, `src/app/api/booking-actions/[id]/route.ts` (+ tests).

- `GET /api/conversations/[id]/booking-actions` → `{ booking: { id, code, start, end } | null, actions: BookingActionView[], history: BookingActionEvent[] (50 terbaru) }`. Nilai "lama" di setiap aksi dibaca dari `bookingData` **saat itu** (`readBookingField`). TASK membawa `impact` dari Task 6.
- `PATCH /api/booking-actions/[id]` body Zod: `{ op: 'reject'; reason?: string } | { op: 'dismiss'; reason?: string } | { op: 'done'; note?: string } | { op: 'not_needed'; note?: string }`. `reject` untuk CHANGE/DATA_REQUEST, `dismiss` untuk MISMATCH (`DISMISSED_CHAT_WRONG`), `done` (`MARKED_DONE`) dan `not_needed` (`NOT_NEEDED`) untuk CHANGE/TASK — keduanya mencatat nama admin dan catatan.
- Label percakapan: daftar Inbox menyertakan `openChangeRequests: number` (CHANGE/TASK OPEN); `ConversationListItem` menampilkan "Permintaan perubahan · belum dipenuhi" bila > 0. Test: `label stays while TASK open`, `label gone after done`, `no expiry after 30 days`.
- Auth: `getSession`. **Tanpa** `hasAdminPowers` (Global Constraints). Aksi yang sudah tertutup → 409.

- [ ] Test:
  - `401 without session`
  - `AGENT can reject`
  - `409 on closed action`
  - `reject records REJECTED with accountId`
  - `GET old value reflects latest bookingData`
- [ ] FAIL → implement → PASS → commit.

### Task 8: UI Inbox + antrean (mobile-first)

**Files:**
- Create: `src/components/inbox/BookingActionsSection.tsx`, `BookingHistoryList.tsx` (+ tests)
- Modify: `src/components/inbox/ContactPanel.tsx` (bagian baru di atas Notes)
- Modify: `src/components/daily-summary/SummaryQueue.tsx` (bagian "Booking" berisi aksi OPEN lintas percakapan; endpoint `GET /api/booking-actions?state=OPEN` ditambah ke route Task 7)

Isi kartu per tipe:
- CHANGE: `Pickup: <lama> → <baru>`, link pesan sumber `/inbox?conversation=…&message=…`, isian yang bisa dikoreksi, tombol **Setujui** (nonaktif + teks "Aktif setelah sambungan ke my-booking tersedia" selama env tulis kosong), tombol **Tolak**. BALI menampilkan: "Vendor transport Bali akan diberi tahu." `tshirt_sizes`: "Vendor kaos akan diberi tahu."
- MISMATCH: "Chat: 5 orang · Booking: 4", tombol **Chat yang salah**.
- TASK: permintaan + dampak + "Ubah di backoffice. Kartu tertutup sendiri." + tombol **Selesai** / **Tidak perlu**.

Komponen mendengarkan `booking-actions.changed` lewat SSE yang sudah dipakai ContactPanel, lalu `announceSummaryItemsChanged()` sesudah aksi.

- [ ] Test:
  - `renders single column at 360px with 44px buttons` (assert kelas/`min-h-11`)
  - `execute disabled when write not configured`
  - `reject calls PATCH and refreshes`
  - `history lists events newest first with actor names`
- [ ] FAIL → implement → PASS.
- [ ] `npm run build` lokal (memori: tsc/eslint tidak menangkap kerusakan bundle klien).
- [ ] Commit.

### Task 8b: PWA + notifikasi push ke admin

**Files:**
- Create: `public/sw.js` (handler `push` → `showNotification`; `notificationclick` → buka/fokus `data.url`)
- Create: `src/lib/push/send.ts` (+ test), `src/app/api/push/subscribe/route.ts` (+ test)
- Modify: `prisma/schema.prisma` (+ `PushSubscription { id, accountId, endpoint @unique, p256dh, auth, createdAt, lastSuccessAt? }`), migrasi aditif
- Modify: `src/components/NotificationListener.tsx` (daftarkan `/sw.js`, minta izin lewat tombol "Nyalakan notifikasi" di halaman — **bukan** otomatis saat load, karena iOS hanya mengizinkan dari gestur pengguna; kirim subscription ke route)
- Modify: `src/lib/booking-actions/store.ts` dan route Task 11/11b (panggil `notifyBookingAction` sesudah transaksi)
- Dependency: `web-push` (versi stabil terbaru yang sudah ≥ 2 minggu). Env: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`. Private key **tidak pernah** dikirim ke klien atau log.

**Interfaces — Produces:**
```ts
export type PushPayload = { title: string; body: string; url: string; tag: string }
export async function notifyBookingAction(e: { kind: 'CHANGE'|'MISMATCH'|'TASK'|'AUTO_APPLIED'|'EXECUTE_FAILED'; conversationId: string; bookingCode: string | null; summary: string; actionId: string }): Promise<void>  // tidak pernah melempar
```
- `POST /api/push/subscribe` (login apa pun, Zod: `endpoint` URL, `keys.p256dh`, `keys.auth`), upsert per `endpoint`. `DELETE` untuk mematikan.
- Pengiriman tidak di-await di jalur webhook. Respons 404/410 dari layanan push → hapus subscription itu.
- `tag` = `booking-action:<actionId>` supaya notifikasi yang sama tidak menumpuk.
- `body` tidak memuat nomor HP, email, atau nama lengkap tamu.

- [ ] Test:
  - `subscribe requires session and validates keys`
  - `notifyBookingAction sends to every subscription of every account`
  - `410 from push service deletes subscription`
  - `payload has no phone/email` (assert regex angka ≥ 8 digit dan `@` tidak ada di body)
  - `push failure never throws into caller`
  - `notification url opens conversation with action`
- [ ] FAIL → implement → PASS → `npm run build` → commit.
- [ ] Uji manual oleh owner (sesuai memori: tanpa uji browser oleh agen): pasang PWA di HP Android dan iPhone, nyalakan notifikasi, kirim pesan dari nomor whitelist.

---

## Fase 2 — Penerapan lewat jalur my-booking

**Gerbang fase:** tidak ada pekerjaan backoffice yang wajib (spec §5.1 P2). Sebelum Task 9, `git fetch` repo legacy lalu baca utuh di `origin/main` `UserBookingsController::updatePickup/updateDrop/updateTshirt` di javavolcano-touroperator dan catat bentuk respons nyatanya.

### Task 9: Klien tulis lewat jalur my-booking

**Files:**
- Create: `src/lib/booking/backoffice-client.ts` (+ test). Env: `LEGACY_BASE_URL` (domain javavolcano-touroperator). `url` booking diambil dari `bookingData.customer_portal` (segmen terakhir `…/my-booking/{url}`).
**Interfaces — Produces:**

```ts
export async function writeBookingChange(bookingId: string, patch: BookingPatch): Promise<{ status: 'ok'; booking: BookingData } | { status: 'error'; httpStatus: number; error: string }>
export type BookingPatch = Partial<Record<'pickup_point'|'pickup_detail'|'pickup_arrival'|'pickup_time'|'drop_point'|'drop_detail'|'drop_arrival'|'drop_time', string>> & { tshirt_sizes?: Record<string, number>; note?: string }
export function writeConfigured(): boolean
```

Memetakan `BookingPatch` ke form legacy: pickup → `POST /bookings/update-pickup/{url}` (`meeting_point`, `flight_ticket_type_number` | `hotel` | `train_ticket_type_number` | `others_location`, `pickup_time1`/`pickup_time2`); drop → `update-drop/{url}`; kaos → `update-tshirt/{url}`. Karena `updatePickup` menulis ulang `meeting_point` dan detailnya sekaligus, klien selalu mengirim titik + detail lengkap yang digabung dari `bookingData` terbaru. Sesudah sukses, segarkan `bookingData` lewat `ensureFreshBookingData`. `note` belum punya jalur → CHANGE `note` tetap menunggu dan hanya bisa ditandai Selesai. Timeout 10 s. Error API **tidak pernah** menghapus `bookingData` (aturan yang sama dengan `BookingLookup`).

- [ ] Test:
  - `timeout → error, bookingData untouched`
  - `url taken from customer_portal; missing url → error, no request`
  - `pickup change sends full point + detail merged from bookingData`
  - `writeConfigured false when env empty`
- [ ] FAIL → implement → PASS → commit.

### Task 10: Booking yang dituju terlihat jelas

**Files:** Modify `src/lib/booking-actions/store.ts` (isi `BookingAction.bookingId` dari `String(bookingData.booking_id)` saat aksi dibuat), `BookingActionsSection.tsx`.

- Tidak ada pemilih booking dan tidak ada route `booking-link` (keputusan owner). Tidak ada kolom tautan di `Conversation`.
- Kartu menampilkan `bookingData.id` (mis. `JVTO-3899`) dan `date.start`–`date.end` tepat di atas tombol Setujui.
- Saat Eksekusi, `bookingId` aksi dibandingkan dengan `bookingData.booking_id` terbaru. Kalau beda → 409 `{ error: "Booking di percakapan ini berubah sejak kartu dibuat. Periksa ulang." }`.

- [ ] Test:
  - `card shows booking code and trip dates`
  - `booking_id changed since card created → execute 409, backoffice not called`
  - `new action stores bookingId from bookingData.booking_id`
- [ ] FAIL → implement → PASS → commit.

### Task 11: Eksekusi

**Files:** Modify `src/app/api/booking-actions/[id]/route.ts` (+ `op: 'execute'; value?: string`), `BookingActionsSection.tsx`.

Alur dalam satu handler:
1. Validasi: action OPEN, tipe CHANGE, `bookingId` sama dengan `bookingData.booking_id` terbaru (Task 10), `writeConfigured()`.
2. Bila `value` berbeda dari usulan, catat `CORRECTED`.
3. `writeBookingChange`.
4. Sukses: simpan `bookingData` dari respons, `EXECUTED` + event (`oldValue` = nilai booking sebelum, `newValue`, `backoffice` = ringkasan status), `reevaluateBookingActions`.
5. Gagal: state tetap OPEN, `lastError`, event `EXECUTE_FAILED`, respons 502 `{ error }`.

- [ ] Test:
  - `execute writes and records EXECUTED with old/new`
  - `corrected value records CORRECTED then EXECUTED`
  - `backoffice 500 → stays OPEN, EXECUTE_FAILED, 502`
  - `unlinked booking → 409`
  - `double click → second call 409, backoffice called once`
- [ ] FAIL → implement → PASS → `npm run build` → commit.

---

## Fase 3 — Permintaan data ke tamu + penutupan

### Task 11a: Kabar ke vendor transport Bali

**Files:** Create `src/lib/booking-actions/bali-vendor.ts` (+ test); Modify alur Task 11.

- Sesudah CHANGE kelompok `BALI` diterapkan: kirim info terbaru (titik/jam antar, kode booking, tanggal, pax) ke vendor transport Bali.
- **Langkah pertama:** `git fetch` repo javavolcano-touroperator, lalu baca cabang `internal_bali_transport` di `XenditController::invoiceSuccess` pada `origin/main` untuk tahu tujuan dan saluran WA `internal_bali_transport` (nomor/grup vendor, template). Pakai tujuan yang sama; isi template "perubahan" baru lewat `SystemTemplate` wa-inbox bila saluran itu wa-inbox. Kalau tujuan vendor tidak bisa ditemukan di kode, berhenti dan tanya owner.
- Gagal kirim → event `VENDOR_NOTICE_FAILED`, push ke admin; perubahan booking tetap berlaku.
- [ ] Test: `BALI change executed → one vendor notice`, `AI change → no vendor notice`, `vendor send failure → admin notified, change kept`.
- [ ] FAIL → implement → PASS → commit.

### Task 11b: Setelan persetujuan + terapkan otomatis + Batalkan

**Files:**
- Modify: `prisma/schema.prisma` (`Settings`: `bookingLightApproval String @default("APPROVE")`, `bookingBaliApproval String @default("APPROVE")`, `dataRequestApproval String @default("ALWAYS")` (keputusan owner 2026-10-19)), migrasi aditif
- Modify: `PATCH /api/settings` (Zod `z.enum(['APPROVE','ALWAYS'])`, tetap `hasAdminPowers()`, `writeBotAuditLog` aksi `UPDATE`), halaman `/settings` (tiga sakelar, mobile-first)
- Modify: `src/lib/booking-actions/store.ts`, `src/app/api/booking-actions/[id]/route.ts` (+ `op: 'revert'`)

**Interfaces — Produces:** `autoApplyIfAllowed(actionId: string): Promise<'applied' | 'skipped' | 'failed'>`. Dipanggil sesudah `applyExtraction` membuat CHANGE. Tier HEAVY selalu `skipped`.

- `ALWAYS`: jalur yang sama dengan Task 11 dengan actor `SYSTEM`, state `EXECUTED`, `closedReason: 'AUTO_APPLIED'`. Gagal → kartu tetap OPEN (menunggu Setujui), event `EXECUTE_FAILED`.
- `op: 'revert'` (semua akun login): hanya untuk `EXECUTED`; tulis `oldValue` dari event `EXECUTED` lewat `writeBookingChange`, event `REVERTED`, state `REJECTED`/`REVERTED`.
- Label tombol di UI: **Setujui**, bukan "Eksekusi".

- [ ] Test:
  - `ALWAYS light → applied without click, event actor SYSTEM`
  - `ALWAYS never applies HEAVY`
  - `APPROVE → stays OPEN`
  - `auto-apply failure → OPEN + EXECUTE_FAILED`
  - `revert writes old value and records REVERTED`
  - `PATCH settings rejects 'AUTO' and requires admin`
- [ ] FAIL → implement → PASS → `npm run build` → commit.

### Task 12: Draf H-7 harian

**Files:**
- Create: `src/lib/booking-actions/data-requests.ts` (+ test)
- Modify: `src/app/api/summary-items/tick/route.ts` (panggil sesudah `reconcileSummaryItems`)

**Interfaces — Produces:** `createDataRequestDrafts(now?: Date): Promise<{ created: number; closed: number }>`

- Kandidat: percakapan dengan `bookingData` yang `date.start_ymd` dalam 0..7 hari WIB dan salah satu dari:
  - `pickup_point='Others'` tanpa detail
  - jam pickup/drop tidak diketahui (`bookingTimeKnown`)
  - titik bandara/stasiun tanpa `pickup_detail`
- Satu `DATA_REQUEST` per booking per `forDay` (unique). Draf kemarin yang OPEN → `SUPERSEDED`. Data lengkap → `RESOLVED`/`DATA_COMPLETE`. Trip mulai → `RESOLVED`/`TRIP_STARTED`.
- `draftText` menyebut hanya data yang kurang (template teks di kode, Bahasa Inggris + Indonesia sesuai negara tamu di `guestDetails.country`; teks ini tidak dikirim ke LLM).
- `dataRequestApproval === 'ALWAYS'` dan jendela 24 jam masih terbuka → dikirim otomatis oleh sistem (event `DRAFT_SENT` actor `SYSTEM`); selain itu menunggu klik Setujui. Test: `ALWAYS + window open → sent automatically; ALWAYS + window closed → not sent`.
- Kirim: memakai jalur kirim composer yang ada. Bila `serviceWindowClosed` (`src/lib/inbox/service-window.ts`), tombol berubah jadi "butuh template" dan tidak mengirim teks bebas. Terkirim → event `DRAFT_SENT`.

- [ ] Test:
  - `H-8 → none; H-7 → one`
  - `Indonesian number → none`
  - `default setting sends automatically within 24h window`
  - `same day twice → still one`
  - `next day → yesterday superseded, new one created`
  - `data completed → resolved DATA_COMPLETE`
  - `window closed → send blocked`
- [ ] FAIL → implement → PASS → commit.

### Task 13: Penutupan dan dokumentasi

- [ ] Koordinasi penutupan `/booking-overview/api`: owner menambahkan pengecekan Bearer di endpoint itu (wa-inbox sudah mengirim `BOOKING_API_KEY` sebagai Bearer, `src/lib/booking/client.ts`). Sesudah owner deploy, cek tick 5 menit masih menyegarkan booking (log `/var/log/wa-inbox-summary-tick.log`).
- [ ] Baca `my:trip-reminder-crew`, `my:reminder-payment`, `my:trip-information`, `my:trip-itinerary-crew`, `my:reminder-bali` di `../javavolcano-touroperator/app/Console/`. Laporkan untuk masing-masing: data dibaca saat kirim atau dari salinan. Perbaikan, kalau ada, diajukan ke owner (repo lain).
- [ ] Pastikan di VPS bahwa `DB_DATABASE` produksi new-backoffice, javavolcano-touroperator, dan crew-portal sama (`jvto`), dan bahwa jalur tulis ber-token memanggil `EcosystemSync::notify`. Eksekusi satu perubahan uji pada booking uji, lalu cek perubahannya terlihat di portal customer, crew-portal, dan sam-app.
- [ ] Perbarui `CLAUDE.md`:
  - §4: bagian baru "Aksi booking"
  - §6: pengecualian kedua untuk route booking-action, beserta alasannya
- [ ] Checklist §8: `npm test`, `npx tsc --noEmit`, `npx eslint .`, `npm run build`. Kirim pesan uji dari nomor whitelist ke percakapan uji yang punya booking, lalu periksa kartu muncul.
- [ ] Commit `docs: aksi booking di CLAUDE.md`.

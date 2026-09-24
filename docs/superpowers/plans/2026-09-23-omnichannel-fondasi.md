# Omnichannel Fondasi — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Melepas asumsi "satu manusia = satu nomor = satu benang" dari database, dan menyiapkan empat sakelar bot per channel — tanpa menambah channel baru apa pun.

**Architecture:** Identitas dipecah jadi `Contact` (manusianya) → `ChannelIdentity` (alamatnya di satu platform) → `Conversation` (benangnya). Perubahan dilakukan **dual-write dulu, pindah sumber kebenaran belakangan, longgarkan constraint terakhir**, sehingga setiap langkah bisa di-rollback sendiri. Sakelar bot per channel dibangun sebagai penulis massal ke `Conversation.botEnabled`, bukan sebagai gerbang runtime kedua.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Prisma 7, PostgreSQL, Vitest + `vitest-mock-extended`.

**Spec:** `docs/superpowers/specs/2026-09-23-omnichannel-inbox-design.md`

## Global Constraints

- **Dilarang `any`.** Pakai `unknown` atau tipe yang sesuai.
- **Dilarang `npx prisma migrate dev`** terhadap database produksi — `DATABASE_URL` di repo ini menunjuk VPS produksi dan perintah itu bisa me-reset database saat mendeteksi drift.
- **Migrasi produksi dibuat offline:** `npx prisma migrate diff --from-schema <lama> --to-schema prisma/schema.prisma --script`, simpan ke `prisma/migrations/<YYYYMMDDHHMMSS>_<snake_case>/migration.sql`, terapkan dengan `npx prisma migrate deploy`.
- **Flagnya `--from-schema` / `--to-schema`**, bukan `--from-schema-datamodel` / `--to-schema-datamodel` — Prisma 7 sudah menghapus varian panjang itu. Diverifikasi 2026-09-24 lewat `npx prisma migrate diff --help`.
- **Periksa isi `migration.sql` sesudah menyimpannya.** `prisma migrate diff` di lingkungan ini kadang mencampur baris log CLI ke stdout, dan baris itu ikut ter-redirect ke file. File migrasi yang memuat teks non-SQL akan menggagalkan `migrate deploy` di produksi, di tengah jalan. Buang barisnya sebelum commit.
- **Sebelum tiap commit:** `npm test`, `npx tsc --noEmit`, `npx eslint .` (0 error, warning boleh). Perintahnya persis itu — `eslint .`, bukan direktori yang sedang dikerjakan.
- **Jalankan ketiga gerbang dari `git status` yang bersih, SESUDAH commit — bukan dari working tree.** Verifikasi atas perubahan yang belum di-commit tidak membuktikan apa pun tentang commit-nya. Task 3 gagal persis begini: perbaikan `tsc` ada di working tree, laporannya menyatakan hijau, dan yang ter-commit merah.
- **Sebelum deploy VPS:** `npm run build` **lokal** dulu — test/tsc/eslint tidak menangkap kerusakan client bundle.
- **Deploy VPS:** `git checkout` dari `origin/main`, dan **export PATH nvm Node 22** atau semua perintah Prisma 7 mati di Node 18 bawaan.
- Otorisasi route mutation lewat `requireAdmin(req)` dari `src/lib/auth/require-admin.ts` (ia yang memanggil `hasAdminPowers()`).
- Audit log lewat `writeBotAuditLog` **hanya** kalau perubahannya mengubah apa yang bot lakukan.
- Response error selalu `{ error: string }` dengan status HTTP yang sesuai.
- **`MessageChannel { OFFICIAL, UNOFFICIAL }` tidak boleh disentuh.** Ia dua jalur WhatsApp, bukan platform.
- Menjalankan satu file test: `npm test -- <path>`.

**Catatan placeholder:** `<user>`, `<db>`, dan `<domain produksi>` sengaja tidak diisi. Kredensial tidak boleh ditulis ke dokumen mana pun (CLAUDE.md §5); ambil nilainya dari `.env` VPS saat menjalankan perintahnya.

---

## File Structure

**Dibuat:**
- `prisma/migrations/20260924080000_channel_identity/migration.sql` — migrasi aditif
- `prisma/migrations/20260924090000_relax_identity_constraints/migration.sql` — pelonggaran constraint
- `src/lib/channel/platform.ts` — helper `Platform`, satu-satunya tempat aturan "platform apa punya nomor telepon"
- `src/lib/channel/platform.test.ts`
- `src/lib/channel/identity.ts` — `upsertChannelIdentity()`, satu-satunya penulis `ChannelIdentity`
- `src/lib/channel/identity.test.ts`
- `src/app/api/bot/channel-toggle/route.ts` — sakelar bot per channel
- `scripts/backfill-channel-identity.mjs` — backfill sekali jalan

**Diubah:**
- `prisma/schema.prisma` — `Platform`, `ChannelIdentity`, kolom `Conversation`, 4 kolom `Settings`, pelonggaran `Contact.phone` dan `Conversation.contactId`
- `src/lib/inbound.ts` — `defaultBotEnabled()` menerima platform; `ingestSingleMessage`/`ingestEchoedMessage` menulis `ChannelIdentity`
- `src/lib/inbound.test.ts` — test untuk perubahan di atas
- `src/app/(authenticated)/chatbot/page.tsx` — empat toggle

**Tidak disentuh sama sekali:** `src/lib/send.ts`, `src/lib/outbound/worker.ts`, `src/lib/bot/orchestrator.ts`, `src/app/api/bot/indonesia-filter/route.ts`.

---

## Task 1: Skema aditif — Platform, ChannelIdentity, kolom Conversation

Tidak ada kode yang memakainya. Tujuannya hanya membuat ruang, supaya kalau ada yang salah, rollback-nya cukup `DROP TABLE` tabel yang belum pernah dibaca siapa pun.

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260924080000_channel_identity/migration.sql`

**Interfaces:**
- Consumes: —
- Produces: model Prisma `ChannelIdentity`, enum `Platform` (`WHATSAPP` | `INSTAGRAM` | `FACEBOOK` | `EMAIL`), field `Conversation.channelIdentityId: string | null`.

- [ ] **Step 1: Tambah enum dan model ke schema**

Tambahkan di `prisma/schema.prisma`, setelah model `WaNumber`:

```prisma
enum Platform {
  WHATSAPP
  INSTAGRAM
  FACEBOOK
  EMAIL
}

/// Alamat satu orang di satu platform. Contact = manusianya; ChannelIdentity = alamatnya.
/// Dipisah karena hanya WhatsApp yang identitasnya nomor telepon: Instagram memberi IGSID,
/// Messenger memberi PSID, email memberi alamat surat. Tanpa tabel ini, identitas non-telepon
/// harus dijejalkan ke Contact.phone dan bertabrakan dengan skema nomor.
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
```

Pada model `Contact`, tambahkan satu baris relasi:

```prisma
  identities      ChannelIdentity[]
```

Pada model `Conversation`, tambahkan (nullable — belum ada yang mengisinya):

```prisma
  /// Null selama masa transisi fondasi; terisi penuh setelah backfill Task 5 selesai.
  channelIdentityId String?
  channelIdentity   ChannelIdentity? @relation(fields: [channelIdentityId], references: [id])

  /// Kunci benang di dalam satu identitas. String kosong = benang tunggal, yang benar untuk
  /// semua DM (WhatsApp/Instagram/Facebook): satu akun = satu percakapan. Email nanti mengisi
  /// kolom ini dengan threadId Gmail, karena satu orang bisa punya banyak benang sekaligus.
  ///
  /// Sengaja string kosong, bukan null: Postgres menganggap setiap NULL berbeda satu sama
  /// lain, jadi unique index yang dipasang di Task 5b tidak akan mengekang apa pun kalau
  /// kolomnya nullable -- dan satu akun bisa diam-diam melahirkan percakapan baru tiap pesan.
  ///
  /// Unique index-nya BELUM dipasang di sini: ia menunggu backfill selesai, karena index
  /// unik yang dibuat di atas data yang masih punya duplikat akan menggagalkan migrasi
  /// di tengah jalan.
  externalThreadId String @default("")
```

- [ ] **Step 2: Buat migrasi offline dan periksa SQL-nya**

```bash
cd /Users/macbook/Code/wa-inbox
git show HEAD:prisma/schema.prisma > /tmp/schema-lama.prisma
npx prisma migrate diff --from-schema /tmp/schema-lama.prisma \
  --to-schema prisma/schema.prisma --script \
  > /tmp/migration-channel-identity.sql
cat /tmp/migration-channel-identity.sql
```

Expected: hanya `CREATE TYPE "Platform"`, `CREATE TABLE "ChannelIdentity"`, `ALTER TABLE "Conversation" ADD COLUMN "channelIdentityId" TEXT`, plus `CREATE INDEX`/`CREATE UNIQUE INDEX` dan `ADD CONSTRAINT ... FOREIGN KEY`.

**GAGALKAN task ini kalau SQL memuat `DROP`, `TRUNCATE`, atau `ALTER COLUMN ... SET NOT NULL`.** Itu berarti schema-nya salah tulis.

- [ ] **Step 3: Simpan migrasi**

```bash
mkdir -p prisma/migrations/20260924080000_channel_identity
cp /tmp/migration-channel-identity.sql prisma/migrations/20260924080000_channel_identity/migration.sql
npx prisma generate
```

- [ ] **Step 4: Verifikasi kompilasi**

Run: `npx tsc --noEmit && npm test && npx eslint .`
Expected: semua lulus. Belum ada test baru — ini murni memastikan client Prisma baru tidak memecahkan apa pun.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260924080000_channel_identity/
git commit -m "feat(schema): tambah Platform + ChannelIdentity (aditif, belum dipakai)"
```

---

## Task 2: Helper platform — satu tempat untuk aturan "punya nomor telepon atau tidak"

**Files:**
- Create: `src/lib/channel/platform.ts`
- Test: `src/lib/channel/platform.test.ts`

**Interfaces:**
- Consumes: enum `Platform` dari `@prisma/client` (Task 1)
- Produces: `hasPhoneNumber(platform: Platform): boolean`, `ALL_PLATFORMS: readonly Platform[]`

- [ ] **Step 1: Tulis test yang gagal**

Create `src/lib/channel/platform.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { hasPhoneNumber, ALL_PLATFORMS } from './platform'

describe('hasPhoneNumber', () => {
  it('hanya WhatsApp yang identitasnya nomor telepon', () => {
    expect(hasPhoneNumber('WHATSAPP')).toBe(true)
    expect(hasPhoneNumber('INSTAGRAM')).toBe(false)
    expect(hasPhoneNumber('FACEBOOK')).toBe(false)
    expect(hasPhoneNumber('EMAIL')).toBe(false)
  })

  // Penjaga: kalau platform kelima ditambahkan tapi hasPhoneNumber tidak diperbarui,
  // filter nomor Indonesia akan tampak menyala di platform itu tapi diam-diam tidak
  // melakukan apa-apa -- persis kegagalan senyap yang tabel ini ada untuk mencegah.
  it('menjawab setiap nilai Platform yang ada', () => {
    expect(ALL_PLATFORMS).toHaveLength(4)
    for (const p of ALL_PLATFORMS) expect(typeof hasPhoneNumber(p)).toBe('boolean')
  })
})
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `npm test -- src/lib/channel/platform.test.ts`
Expected: FAIL — `Failed to resolve import "./platform"`.

- [ ] **Step 3: Implementasi minimal**

Create `src/lib/channel/platform.ts`:

```ts
import type { Platform } from '@prisma/client'

/**
 * Satu-satunya tempat yang menjawab "platform ini identitasnya nomor telepon atau bukan".
 *
 * Ada sebagai tabel eksplisit, bukan sebagai pengecekan regex di tempat pemakaian, karena
 * IGSID dan PSID adalah angka panjang: regex `/^62\d+$/` di src/lib/phone.ts kebetulan tidak
 * mencocokinya, jadi filter nomor Indonesia akan tampak berlaku di Instagram/Facebook padahal
 * tidak pernah sekali pun mengenai apa-apa. Kegagalan senyap seperti itu tidak pernah
 * dilaporkan siapa pun.
 */
export const ALL_PLATFORMS = ['WHATSAPP', 'INSTAGRAM', 'FACEBOOK', 'EMAIL'] as const satisfies readonly Platform[]

const PHONE_BASED: ReadonlySet<Platform> = new Set<Platform>(['WHATSAPP'])

export function hasPhoneNumber(platform: Platform): boolean {
  return PHONE_BASED.has(platform)
}
```

- [ ] **Step 4: Jalankan, pastikan lulus**

Run: `npm test -- src/lib/channel/platform.test.ts`
Expected: PASS (2 test).

- [ ] **Step 5: Commit**

```bash
git add src/lib/channel/platform.ts src/lib/channel/platform.test.ts
git commit -m "feat(channel): helper hasPhoneNumber sebagai satu sumber aturan platform"
```

---

## Task 3: `upsertChannelIdentity()` — satu-satunya penulis ChannelIdentity

**Files:**
- Create: `src/lib/channel/identity.ts`
- Test: `src/lib/channel/identity.test.ts`

**Interfaces:**
- Consumes: `prisma` dari `@/lib/db`, enum `Platform`
- Produces:
  ```ts
  upsertChannelIdentity(input: {
    platform: Platform
    externalId: string
    contactId: string
    displayName?: string | null
  }): Promise<{ id: string; contactId: string }>
  ```

- [ ] **Step 1: Tulis test yang gagal**

Create `src/lib/channel/identity.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

import { upsertChannelIdentity } from './identity'

beforeEach(() => {
  mockReset(mockPrisma)
})

describe('upsertChannelIdentity', () => {
  it('mencari lewat pasangan (platform, externalId), bukan lewat externalId saja', async () => {
    mockPrisma.channelIdentity.upsert.mockResolvedValue({ id: 'ci_1', contactId: 'c_1' } as never)

    await upsertChannelIdentity({ platform: 'FACEBOOK', externalId: '123', contactId: 'c_1' })

    const arg = mockPrisma.channelIdentity.upsert.mock.calls[0][0]
    expect(arg.where).toEqual({ platform_externalId: { platform: 'FACEBOOK', externalId: '123' } })
  })

  // Nomor WhatsApp dan PSID Facebook bisa kebetulan sama persis sebagai string angka.
  // Tanpa platform ikut jadi kunci, pesan Facebook akan menempel ke kontak WhatsApp
  // orang lain -- dan riwayat dua orang asing tergabung tanpa ada yang menyadarinya.
  it('tidak menimpa identitas platform lain yang externalId-nya kebetulan sama', async () => {
    mockPrisma.channelIdentity.upsert.mockResolvedValue({ id: 'ci_2', contactId: 'c_2' } as never)

    await upsertChannelIdentity({ platform: 'WHATSAPP', externalId: '123', contactId: 'c_2' })

    // Cast-nya wajib: tipe `where` yang disimpulkan Prisma untuk argumen mock adalah union,
    // jadi `platform_externalId` mungkin undefined dan `tsc --noEmit` menolak akses langsung
    // (TS18048). Ia hanya menyempitkan tipe saat kompilasi -- nilai yang diperiksa tetap
    // argumen sungguhan yang diterima upsert, jadi test ini tetap menangkap platform salah.
    const arg = mockPrisma.channelIdentity.upsert.mock.calls[0][0] as unknown as {
      where: { platform_externalId: { platform: string } }
    }
    expect(arg.where.platform_externalId.platform).toBe('WHATSAPP')
  })

  it('tidak menghapus displayName yang sudah ada saat pemanggil tidak membawanya', async () => {
    mockPrisma.channelIdentity.upsert.mockResolvedValue({ id: 'ci_3', contactId: 'c_3' } as never)

    await upsertChannelIdentity({ platform: 'INSTAGRAM', externalId: 'igsid_9', contactId: 'c_3' })

    const arg = mockPrisma.channelIdentity.upsert.mock.calls[0][0]
    expect(arg.update).toEqual({})
  })

  it('memperbarui displayName saat pemanggil membawanya', async () => {
    mockPrisma.channelIdentity.upsert.mockResolvedValue({ id: 'ci_4', contactId: 'c_4' } as never)

    await upsertChannelIdentity({
      platform: 'INSTAGRAM', externalId: 'igsid_9', contactId: 'c_4', displayName: 'Anna',
    })

    const arg = mockPrisma.channelIdentity.upsert.mock.calls[0][0]
    expect(arg.update).toEqual({ displayName: 'Anna' })
  })
})
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `npm test -- src/lib/channel/identity.test.ts`
Expected: FAIL — `Failed to resolve import "./identity"`.

- [ ] **Step 3: Implementasi minimal**

Create `src/lib/channel/identity.ts`:

```ts
import type { Platform } from '@prisma/client'
import { prisma } from '@/lib/db'

/**
 * Satu-satunya penulis tabel ChannelIdentity.
 *
 * Kuncinya SELALU pasangan (platform, externalId), tidak pernah externalId saja: nomor
 * WhatsApp dan PSID Facebook sama-sama string angka dan bisa bertabrakan. Kalau platform
 * tidak ikut jadi kunci, pesan Facebook menempel ke kontak WhatsApp orang lain dan riwayat
 * dua orang asing tergabung tanpa ada yang menyadarinya.
 *
 * `displayName` tidak ikut ditulis saat pemanggil tidak membawanya -- mengirim `undefined`
 * ke Prisma akan dihitung sebagai "jangan ubah", tapi menulisnya eksplisit sebagai `null`
 * akan menghapus nama yang sudah tersimpan dari giliran sebelumnya.
 */
export async function upsertChannelIdentity(input: {
  platform: Platform
  externalId: string
  contactId: string
  displayName?: string | null
}): Promise<{ id: string; contactId: string }> {
  const { platform, externalId, contactId, displayName } = input

  return prisma.channelIdentity.upsert({
    where: { platform_externalId: { platform, externalId } },
    update: displayName ? { displayName } : {},
    create: { platform, externalId, contactId, displayName: displayName ?? null },
    select: { id: true, contactId: true },
  })
}
```

- [ ] **Step 4: Jalankan, pastikan lulus**

Run: `npm test -- src/lib/channel/identity.test.ts`
Expected: PASS (4 test).

- [ ] **Step 5: Commit**

```bash
git add src/lib/channel/identity.ts src/lib/channel/identity.test.ts
git commit -m "feat(channel): upsertChannelIdentity berkunci (platform, externalId)"
```

---

## Task 4: Dual-write — inbound WhatsApp mulai menulis ChannelIdentity

Sumber kebenaran **masih** `Conversation.contactId`. Task ini hanya menambah tulisan kedua, supaya percakapan baru sudah punya identitas saat backfill Task 5 berjalan.

**Files:**
- Modify: `src/lib/inbound.ts` (di `ingestSingleMessage`, setelah `prisma.contact.upsert`)
- Test: `src/lib/inbound.test.ts`

**Interfaces:**
- Consumes: `upsertChannelIdentity` (Task 3)
- Produces: setiap `Conversation` yang dibuat/diperbarui lewat jalur WhatsApp punya `channelIdentityId` terisi.

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan ke `src/lib/inbound.test.ts`, di dalam `describe` utama:

```ts
it('menulis ChannelIdentity WhatsApp untuk pesan masuk', async () => {
  stubHappyPath()
  await ingestMetaMessage(samplePayload)

  expect(mockPrisma.channelIdentity.upsert).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { platform_externalId: { platform: 'WHATSAPP', externalId: '6281234567890' } },
    }),
  )
})

it('menautkan conversation ke ChannelIdentity yang baru ditulis', async () => {
  stubHappyPath()
  mockPrisma.channelIdentity.upsert.mockResolvedValue({ id: 'ci_wa_1', contactId: 'contact_1' } as never)

  await ingestMetaMessage(samplePayload)

  const arg = mockPrisma.conversation.upsert.mock.calls[0][0]
  expect(arg.create).toEqual(expect.objectContaining({ channelIdentityId: 'ci_wa_1' }))
  expect(arg.update).toEqual(expect.objectContaining({ channelIdentityId: 'ci_wa_1' }))
})
```

Ganti `'6281234567890'` dengan nilai `from` yang benar-benar dipakai `samplePayload` di file itu — baca dulu konstanta `samplePayload` di kepala file dan pakai nilainya persis.

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `npm test -- src/lib/inbound.test.ts`
Expected: FAIL — `channelIdentity.upsert` tidak pernah dipanggil.

- [ ] **Step 3: Implementasi minimal**

Di `src/lib/inbound.ts`, tambahkan import:

```ts
import { upsertChannelIdentity } from '@/lib/channel/identity'
```

Di `ingestSingleMessage`, tepat setelah `const contact = await prisma.contact.upsert({...})` dan sebelum `const conversation = ...`:

```ts
  // Dual-write masa transisi: Conversation.contactId masih sumber kebenaran, tapi setiap
  // percakapan baru sudah membawa identitasnya supaya backfill hanya perlu mengurus baris lama.
  const identity = await upsertChannelIdentity({
    platform: 'WHATSAPP',
    externalId: contact.phone,
    contactId: contact.id,
    displayName: profileName,
  })
```

Lalu ubah `prisma.conversation.upsert` menjadi:

```ts
  const conversation = await prisma.conversation.upsert({
    where: { contactId: contact.id },
    update: { lastMessageAt: sentAt, channelIdentityId: identity.id },
    create: {
      contactId: contact.id,
      lastMessageAt: sentAt,
      channelIdentityId: identity.id,
      botEnabled: await defaultBotEnabled(contact.phone),
    },
  })
```

Lakukan perubahan yang sama persis di `ingestEchoedMessage`, dengan `echo.to` sebagai `externalId` dan tanpa `displayName`.

- [ ] **Step 4: Jalankan, pastikan lulus**

Run: `npm test -- src/lib/inbound.test.ts`
Expected: PASS, termasuk seluruh test lama.

- [ ] **Step 5: Verifikasi penuh dan commit**

```bash
npm test && npx tsc --noEmit && npx eslint .
git add src/lib/inbound.ts src/lib/inbound.test.ts
git commit -m "feat(inbound): dual-write ChannelIdentity WhatsApp"
```

- [ ] **Step 6: Deploy dan verifikasi sehat**

```bash
npm run build   # WAJIB lokal dulu -- test/tsc/eslint tidak menangkap kerusakan client bundle
```

Kalau exit 0, push dan deploy ke VPS (export PATH nvm Node 22 di sana), jalankan `npx prisma migrate deploy`, lalu smoke test:

```bash
curl -sI https://<domain produksi> | head -1
```

Expected: `HTTP/2 200`. **Jangan lanjut ke Task 5 sebelum ini hijau.**

---

## Task 5: Backfill baris lama + verifikasi

**Files:**
- Create: `scripts/backfill-channel-identity.mjs`

**Interfaces:**
- Consumes: tabel `ChannelIdentity` (Task 1), tulisan dual-write (Task 4)
- Produces: setiap `Conversation` punya `channelIdentityId` non-null.

- [ ] **Step 1: Cadangkan database produksi**

```bash
ssh root@31.97.223.43 "pg_dump -U <user> -d <db> -F c -f /root/backup-pre-channel-identity-$(date +%F).dump && ls -lh /root/backup-pre-channel-identity-*.dump"
```

Expected: file dump ada dan ukurannya wajar. **Jangan lanjut tanpa ini.**

- [ ] **Step 2: SELECT verifikasi SEBELUM**

```bash
ssh root@31.97.223.43 "psql -U <user> -d <db> -c '
  SELECT (SELECT count(*) FROM \"Contact\") AS kontak,
         (SELECT count(*) FROM \"Conversation\") AS percakapan,
         (SELECT count(*) FROM \"Conversation\" WHERE \"channelIdentityId\" IS NULL) AS belum_tertaut;'"
```

Catat ketiga angkanya. Angka ketiga adalah yang harus jadi **0** setelah backfill.

- [ ] **Step 3: Tulis skrip backfill**

Create `scripts/backfill-channel-identity.mjs`:

```js
#!/usr/bin/env node
/**
 * Backfill sekali jalan: tiap Contact yang punya phone mendapat satu ChannelIdentity
 * WHATSAPP, dan tiap Conversation ditautkan ke identitas kontaknya.
 *
 * Idempoten: dijalankan dua kali menghasilkan keadaan yang sama, karena upsert berkunci
 * (platform, externalId) dan update hanya menyentuh baris yang channelIdentityId-nya null.
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

let identitas = 0
let tertaut = 0

const contacts = await prisma.contact.findMany({ select: { id: true, phone: true, name: true } })

for (const c of contacts) {
  if (!c.phone) continue
  const identity = await prisma.channelIdentity.upsert({
    where: { platform_externalId: { platform: 'WHATSAPP', externalId: c.phone } },
    update: {},
    create: { platform: 'WHATSAPP', externalId: c.phone, contactId: c.id, displayName: c.name },
    select: { id: true },
  })
  identitas += 1

  const res = await prisma.conversation.updateMany({
    where: { contactId: c.id, channelIdentityId: null },
    data: { channelIdentityId: identity.id },
  })
  tertaut += res.count
}

const sisa = await prisma.conversation.count({ where: { channelIdentityId: null } })

console.log(`identitas disiapkan : ${identitas}`)
console.log(`conversation tertaut: ${tertaut}`)
console.log(`masih null          : ${sisa}`)

await prisma.$disconnect()

if (sisa > 0) {
  console.error(`\nGAGAL: ${sisa} conversation masih tanpa channelIdentityId.`)
  process.exit(1)
}
console.log('\nOK: setiap conversation punya channelIdentityId.')
```

- [ ] **Step 4: Jalankan backfill di VPS**

```bash
ssh root@31.97.223.43 'export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22; cd /var/www/wa-inbox && node scripts/backfill-channel-identity.mjs'
```

Expected: `masih null: 0` dan exit 0. Kalau bukan 0, skrip keluar dengan kode 1 — **jangan lanjut**, laporkan angkanya.

- [ ] **Step 5: SELECT verifikasi SESUDAH**

Jalankan ulang kueri Step 2. `belum_tertaut` harus **0**, dan `percakapan` harus **sama persis** dengan angka sebelum backfill — kalau berubah, ada yang menulis di luar dugaan.

- [ ] **Step 6: Commit**

```bash
git add scripts/backfill-channel-identity.mjs
git commit -m "chore(backfill): tautkan Conversation lama ke ChannelIdentity WhatsApp"
```

---

## Task 5b: Pindahkan SEMUA pencarian dari kunci yang akan dilepas

**Task ini tidak boleh dilewati, dan urutannya tidak boleh ditukar dengan Task 9.**

Prisma mewajibkan field di `where` sebuah upsert punya constraint unik. Task 9 melepas **dua** constraint, dan di `src/lib/inbound.ts` ada **empat** call site yang bergantung padanya — dua di `ingestSingleMessage`, dua di `ingestEchoedMessage`:

| Baris | Pemanggilan | Bergantung pada |
| --- | --- | --- |
| `:519-520` | `contact.upsert({ where: { phone: message.from } })` | `Contact.phone @unique` |
| `:526-527` | `conversation.upsert({ where: { contactId } })` | `Conversation.contactId @unique` |
| `:633-634` | `contact.upsert({ where: { phone: echo.to } })` | `Contact.phone @unique` |
| `:640-641` | `conversation.upsert({ where: { contactId } })` | `Conversation.contactId @unique` |

Begitu Task 9 jalan, **keempatnya berhenti dikompilasi dan ingest WhatsApp patah total.** Jadi semuanya harus pindah lebih dulu, dalam satu task, supaya tidak pernah ada keadaan ter-deploy di mana separuh sudah pindah dan separuh belum.

Resolusi kontak berpindah lewat `ChannelIdentity` — pola yang sama dengan yang dipakai jalur Facebook nanti, sehingga kedua jalur seragam:

```
cari ChannelIdentity(WHATSAPP, nomor)
  ├─ ketemu     → pakai contactId-nya, perbarui nama kalau ada yang baru
  └─ tidak ada  → buat Contact baru, lalu identitasnya
```

**Files:**
- Modify: `prisma/schema.prisma` (unique index baru)
- Create: `prisma/migrations/20260924095000_conversation_thread_key/migration.sql`
- Modify: `src/lib/inbound.ts`
- Test: `src/lib/inbound.test.ts`

**Interfaces:**
- Consumes: backfill selesai (Task 5), `externalThreadId` (Task 1)
- Produces: `Conversation` dikunci oleh `@@unique([channelIdentityId, externalThreadId])`.

- [ ] **Step 1: Verifikasi tidak ada duplikat**

```bash
ssh root@31.97.223.43 "psql -U <user> -d <db> -c '
  SELECT \"channelIdentityId\", count(*) FROM \"Conversation\"
  WHERE \"channelIdentityId\" IS NOT NULL
  GROUP BY 1 HAVING count(*) > 1;'"
```

Expected: **0 baris.** Kalau ada, `CREATE UNIQUE INDEX` akan gagal di tengah `migrate deploy`. Laporkan angkanya dan berhenti — jangan paksa.

- [ ] **Step 2: Tambahkan unique index ke schema**

Pada `model Conversation`:

```prisma
  @@unique([channelIdentityId, externalThreadId])
```

- [ ] **Step 3: Buat dan periksa migrasi**

```bash
git show HEAD:prisma/schema.prisma > /tmp/schema-lama.prisma
npx prisma migrate diff --from-schema /tmp/schema-lama.prisma \
  --to-schema prisma/schema.prisma --script > /tmp/m.sql
cat /tmp/m.sql
mkdir -p prisma/migrations/20260924095000_conversation_thread_key
cp /tmp/m.sql prisma/migrations/20260924095000_conversation_thread_key/migration.sql
npx prisma generate
```

Expected: hanya `CREATE UNIQUE INDEX "Conversation_channelIdentityId_externalThreadId_key"`. Tidak ada `DROP`.

- [ ] **Step 4: Tulis test yang gagal**

Tambahkan ke `src/lib/inbound.test.ts`:

```ts
describe('pencarian lepas dari kunci unik lama', () => {
  it('mencari conversation lewat kunci benang, bukan lewat contactId', async () => {
    stubHappyPath()
    mockPrisma.channelIdentity.findUnique.mockResolvedValue({ contactId: 'contact_1' } as never)
    mockPrisma.channelIdentity.upsert.mockResolvedValue({ id: 'ci_wa_1', contactId: 'contact_1' } as never)

    await ingestMetaMessage(samplePayload)

    const arg = mockPrisma.conversation.upsert.mock.calls[0][0]
    expect(arg.where).toEqual({
      channelIdentityId_externalThreadId: { channelIdentityId: 'ci_wa_1', externalThreadId: '' },
    })
  })

  // contact.upsert({ where: { phone } }) berhenti dikompilasi begitu Task 9 melepas
  // Contact.phone @unique. Kontak dicari lewat identitasnya, bukan lewat nomornya.
  it('tidak pernah memanggil contact.upsert', async () => {
    stubHappyPath()
    mockPrisma.channelIdentity.findUnique.mockResolvedValue({ contactId: 'contact_1' } as never)

    await ingestMetaMessage(samplePayload)

    expect(mockPrisma.contact.upsert).not.toHaveBeenCalled()
  })

  it('memakai kontak yang sudah tertaut ke identitas itu', async () => {
    stubHappyPath()
    mockPrisma.channelIdentity.findUnique.mockResolvedValue({ contactId: 'contact_lama' } as never)

    await ingestMetaMessage(samplePayload)

    expect(mockPrisma.contact.create).not.toHaveBeenCalled()
    expect(mockPrisma.channelIdentity.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ contactId: 'contact_lama' }),
    )
  })

  it('membuat kontak baru saat identitasnya belum pernah ada', async () => {
    stubHappyPath()
    mockPrisma.channelIdentity.findUnique.mockResolvedValue(null as never)
    mockPrisma.contact.create.mockResolvedValue({ id: 'contact_baru', phone: '6281234567890' } as never)

    await ingestMetaMessage(samplePayload)

    expect(mockPrisma.contact.create).toHaveBeenCalled()
  })
})
```

Ganti `'6281234567890'` dengan nilai `from` yang benar-benar dipakai `samplePayload` di file itu.

- [ ] **Step 5: Jalankan, pastikan gagal**

Run: `npm test -- src/lib/inbound.test.ts`
Expected: FAIL — `contact.upsert` masih dipanggil dan `where` conversation masih `{ contactId: ... }`.

- [ ] **Step 6: Pindahkan keempat call site**

Di `src/lib/inbound.ts`, pada `ingestSingleMessage`, ganti blok resolusi kontak + conversation:

```ts
  // Kontak dicari lewat identitasnya, bukan lewat nomornya. Setelah Task 9 melepas
  // Contact.phone @unique, Prisma menolak `phone` di `where` sebuah upsert -- dan nomor
  // memang bukan lagi identitas: ia hanya salah satu alamat, kebetulan yang pertama ada.
  const known = await prisma.channelIdentity.findUnique({
    where: { platform_externalId: { platform: 'WHATSAPP', externalId: message.from } },
    select: { contactId: true },
  })

  const contact = known
    ? await prisma.contact.update({
        where: { id: known.contactId },
        data: profileName ? { name: profileName } : {},
      })
    : await prisma.contact.create({ data: { phone: message.from, name: profileName ?? null } })

  const identity = await upsertChannelIdentity({
    platform: 'WHATSAPP',
    // Diambil dari payload, bukan dari contact.phone: setelah Task 9 kolom itu bertipe
    // `string | null` dan tidak bisa dipakai sebagai externalId yang wajib string.
    externalId: message.from,
    contactId: contact.id,
    displayName: profileName,
  })

  const sentAt = parseMetaTimestamp(message.timestamp)

  const conversation = await prisma.conversation.upsert({
    // Dikunci lewat (channelIdentityId, externalThreadId), bukan contactId: setelah Task 9
    // melepas Conversation.contactId @unique, Prisma menolak contactId di `where` sebuah
    // upsert karena ia bukan lagi field unik.
    where: {
      channelIdentityId_externalThreadId: { channelIdentityId: identity.id, externalThreadId: '' },
    },
    update: { lastMessageAt: sentAt },
    create: {
      contactId: contact.id,
      channelIdentityId: identity.id,
      externalThreadId: '',
      lastMessageAt: sentAt,
      botEnabled: await defaultBotEnabled(message.from),
    },
  })
```

Lakukan perubahan yang sama persis di `ingestEchoedMessage`, dengan `echo.to` menggantikan `message.from` dan tanpa `displayName`.

Blok `upsertChannelIdentity` yang ditambahkan Task 4 sekarang tergantikan oleh blok di atas — pastikan tidak ada dua pemanggilan berturut-turut.

- [ ] **Step 7: Jalankan, pastikan lulus**

Run: `npm test && npx tsc --noEmit && npx eslint . && npm run build`
Expected: semua lulus.

- [ ] **Step 8: Commit dan deploy**

```bash
git add prisma/ src/lib/inbound.ts src/lib/inbound.test.ts
git commit -m "feat(inbound): kunci conversation lewat (channelIdentityId, externalThreadId)"
```

Deploy, `npx prisma migrate deploy`, lalu `curl -sI https://<domain produksi> | head -1` → `HTTP/2 200`.

Kirim satu pesan WhatsApp dari nomor whitelist `6282143403501` dan pastikan masuk ke percakapan **yang sudah ada**, bukan percakapan baru. **Jangan lanjut ke Task 6 sebelum ini terbukti.**

---

## Task 5c: Tiga file lain yang juga memakai kunci lama

**Task ini lahir dari kesalahan, dan alasannya ditulis supaya tidak terulang.**

Task 5b memindahkan empat call site di `src/lib/inbound.ts`. Cakupan itu ditentukan dengan menggeledah **satu file saja** — persis kesalahan yang CLAUDE.md §9 peringatkan (*"Satu file bukan keseluruhan"*). Geledah ulang seluruh repo menemukan **enam call site lagi di tiga file**, dua di antaranya jalur produksi:

| File | Baris | Jalur |
| --- | --- | --- |
| `src/lib/test-conversation.ts` | 14, 19 | **Produksi** — `ensureTestConversation()` jalan tiap kali daftar inbox dimuat |
| `src/lib/system-templates/send.ts` | 144, 153 | **Produksi** — kiriman template ke nomor pelanggan |
| `src/lib/bot/eval/run-eval.ts` | 52, 57 | `npm run eval`, 13 golden case |

Tanpa task ini, Task 9 mematahkan sandbox Test Bot, pengiriman template, dan seluruh suite eval — dan dua yang pertama baru ketahuan saat ada yang memakainya.

**Files:**
- Modify: `src/lib/test-conversation.ts`
- Modify: `src/lib/system-templates/send.ts`
- Modify: `src/lib/bot/eval/run-eval.ts`
- Test: file test yang sudah ada untuk ketiganya

**Interfaces:**
- Consumes: `upsertChannelIdentity()` (Task 3), kunci `channelIdentityId_externalThreadId` (Task 5b)
- Produces: nol pemakaian `contact.upsert({ where: { phone } })` dan `conversation.upsert({ where: { contactId } })` di seluruh repo

- [ ] **Step 1: Tulis test yang gagal — penjaga mekanis untuk seluruh repo**

Buat `src/lib/channel/no-legacy-keys.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Penjaga lintas-repo, bukan test unit.
 *
 * Task 9 melepas Contact.phone @unique dan Conversation.contactId @unique. Prisma menolak
 * field non-unik di `where` sebuah upsert, jadi setiap pemakaian yang tersisa berhenti
 * dikompilasi begitu migrasi itu jalan. Cakupan Task 5b ditentukan dengan menggeledah satu
 * file dan meleset enam call site di tiga file -- test ini ada supaya kesalahan itu tidak
 * bisa terulang diam-diam.
 */
function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p))
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(p)
  }
  return out
}

describe('tidak ada lagi upsert berkunci lama di seluruh repo', () => {
  it('nol contact.upsert({ where: { phone } }) dan conversation.upsert({ where: { contactId } })', () => {
    const offenders: string[] = []

    for (const file of sourceFiles('src')) {
      const src = readFileSync(file, 'utf8')
      if (/contact\.upsert\(\s*\{[\s\S]{0,120}?where:\s*\{\s*phone/.test(src)) {
        offenders.push(`${file}: contact.upsert({ where: { phone } })`)
      }
      if (/conversation\.upsert\(\s*\{[\s\S]{0,120}?where:\s*\{\s*contactId/.test(src)) {
        offenders.push(`${file}: conversation.upsert({ where: { contactId } })`)
      }
    }

    expect(offenders).toEqual([])
  })
})
```

- [ ] **Step 2: Jalankan, pastikan gagal dengan DAFTAR yang benar**

Run: `npm test -- src/lib/channel/no-legacy-keys.test.ts`

Expected: FAIL, dan daftar `offenders` memuat **tepat tiga file**: `test-conversation.ts`, `system-templates/send.ts`, `bot/eval/run-eval.ts`. Kalau daftarnya memuat file lain, catat — berarti masih ada yang terlewat lagi.

- [ ] **Step 3: Pindahkan `src/lib/test-conversation.ts`**

Kontaknya memakai sentinel `TEST_CONTACT_PHONE = '__bot_test__'` yang sengaja non-numerik. Sentinel itu **tetap dipakai** sebagai `externalId` — ia tetap unik di dalam platform WhatsApp, dan tidak akan pernah bertabrakan dengan nomor sungguhan.

```ts
export async function ensureTestConversation(): Promise<void> {
  // Dicari lewat identitas, bukan lewat nomor: Task 9 melepas Contact.phone @unique dan
  // Prisma menolak field non-unik di `where` sebuah upsert. Sentinel-nya tetap sama.
  const known = await prisma.channelIdentity.findUnique({
    where: { platform_externalId: { platform: 'WHATSAPP', externalId: TEST_CONTACT_PHONE } },
    select: { contactId: true },
  })

  const contact =
    known ??
    (await prisma.contact.create({
      data: { phone: TEST_CONTACT_PHONE, name: '🧪 Tes Bot (Internal)' },
    }).then((c) => ({ contactId: c.id })))

  const identity = await upsertChannelIdentity({
    platform: 'WHATSAPP',
    externalId: TEST_CONTACT_PHONE,
    contactId: contact.contactId,
  })

  await prisma.conversation.upsert({
    where: {
      channelIdentityId_externalThreadId: { channelIdentityId: identity.id, externalThreadId: '' },
    },
    update: {},
    create: {
      contactId: contact.contactId,
      channelIdentityId: identity.id,
      externalThreadId: '',
      isPinned: true,
      isTest: true,
    },
  })
}
```

Tambahkan import `upsertChannelIdentity` dari `@/lib/channel/identity`.

- [ ] **Step 4: Pindahkan `src/lib/system-templates/send.ts`**

Ini jalur pelanggan sungguhan — perlakukan dengan hati-hati. Pertahankan pembungkus `upsertOnce()` yang sudah ada; ia menangani balapan, dan menghapusnya akan memperkenalkan bug yang tidak berhubungan.

```ts
  const nameValue = params.variables.name
  const resolvedName = typeof nameValue === 'string' && nameValue.trim() ? nameValue.trim() : null

  const known = await prisma.channelIdentity.findUnique({
    where: { platform_externalId: { platform: 'WHATSAPP', externalId: phone } },
    select: { contactId: true },
  })

  const contact = known
    ? await prisma.contact.update({
        where: { id: known.contactId },
        data: resolvedName ? { name: resolvedName } : {},
      })
    : await upsertOnce(() => prisma.contact.create({ data: { phone, name: resolvedName } }))

  const identity = await upsertChannelIdentity({
    platform: 'WHATSAPP',
    externalId: phone,
    contactId: contact.id,
    displayName: resolvedName,
  })

  const now = new Date()
  const botEnabled = await defaultBotEnabled(phone)

  const conversation = await upsertOnce(() =>
    prisma.conversation.upsert({
      where: {
        channelIdentityId_externalThreadId: { channelIdentityId: identity.id, externalThreadId: '' },
      },
      update: { lastMessageAt: now },
      create: {
        contactId: contact.id,
        channelIdentityId: identity.id,
        externalThreadId: '',
        lastMessageAt: now,
        botEnabled,
      },
    })
  )
```

`defaultBotEnabled(phone)` masih bertanda tangan lama di sini — **jangan diubah di task ini**, Task 6 yang mengubahnya bersama seluruh pemanggil lainnya.

- [ ] **Step 5: Pindahkan `src/lib/bot/eval/run-eval.ts`**

Telepon sintetiknya `eval-${c.id}` — tetap dipakai sebagai `externalId`.

```ts
  const phone = `eval-${c.id}`

  const known = await prisma.channelIdentity.findUnique({
    where: { platform_externalId: { platform: 'WHATSAPP', externalId: phone } },
    select: { contactId: true },
  })

  const contact = known
    ? { id: known.contactId }
    : await prisma.contact.create({ data: { phone, name: `eval ${c.id}` } })

  const identity = await upsertChannelIdentity({
    platform: 'WHATSAPP',
    externalId: phone,
    contactId: contact.id,
  })

  const conversation = await prisma.conversation.upsert({
    where: {
      channelIdentityId_externalThreadId: { channelIdentityId: identity.id, externalThreadId: '' },
    },
    update: { tripBrief: {}, botEnabled: true },
    create: {
      contactId: contact.id,
      channelIdentityId: identity.id,
      externalThreadId: '',
      botEnabled: true,
      isTest: true,
      tripBrief: {},
    },
  })
```

- [ ] **Step 6: Jalankan penjaga, pastikan LULUS**

Run: `npm test -- src/lib/channel/no-legacy-keys.test.ts`
Expected: PASS — `offenders` kosong.

- [ ] **Step 7: Verifikasi penuh**

Run: `npm test && npx tsc --noEmit && npx eslint . && npm run build`
Expected: semua lulus. Test yang mem-mock `contact.upsert` di ketiga jalur ini perlu disesuaikan ke `contact.create` / `contact.update` — sesuaikan mock-nya, **jangan melonggarkan assertion-nya**.

- [ ] **Step 8: Commit**

```bash
git add src/lib/test-conversation.ts src/lib/system-templates/send.ts src/lib/bot/eval/run-eval.ts src/lib/channel/no-legacy-keys.test.ts
git commit -m "feat(channel): pindahkan tiga jalur terakhir dari kunci unik lama"
```

---

## Task 6: Empat sakelar bot per channel di Settings

**Files:**
- Modify: `prisma/schema.prisma` (4 kolom `Settings`)
- Create: `prisma/migrations/20260924100000_bot_toggle_per_channel/migration.sql`
- Modify: `src/lib/inbound.ts` (`defaultBotEnabled`)
- Test: `src/lib/inbound.test.ts`

**Interfaces:**
- Consumes: `hasPhoneNumber` (Task 2)
- Produces: `defaultBotEnabled(input: { platform: Platform; phone: string | null }): Promise<boolean>`

- [ ] **Step 1: Tambah kolom ke schema**

Pada model `Settings` di `prisma/schema.prisma`:

```prisma
  /// Sakelar autoreply bot per platform. Seperti botAutoReplyAll, keempatnya BUKAN gerbang
  /// runtime: saat di-toggle mereka menulis massal ke Conversation.botEnabled, lalu menyingkir.
  /// Gerbang runtime tetap satu (Conversation.botEnabled) supaya "Ambil Alih dari Bot" per chat
  /// tidak bisa tertimpa diam-diam -- lihat komentar di kepala defaultBotEnabled().
  /// Default: hanya WhatsApp menyala, karena channel lain belum ada saat kolom ini lahir.
  botEnabledWhatsapp Boolean @default(true)
  botEnabledInstagram Boolean @default(false)
  botEnabledFacebook Boolean @default(false)
  botEnabledEmail    Boolean @default(false)
```

- [ ] **Step 2: Buat dan periksa migrasi**

```bash
git show HEAD:prisma/schema.prisma > /tmp/schema-lama.prisma
npx prisma migrate diff --from-schema /tmp/schema-lama.prisma \
  --to-schema prisma/schema.prisma --script > /tmp/m.sql
cat /tmp/m.sql
mkdir -p prisma/migrations/20260924100000_bot_toggle_per_channel
cp /tmp/m.sql prisma/migrations/20260924100000_bot_toggle_per_channel/migration.sql
npx prisma generate
```

Expected: hanya `ALTER TABLE "Settings" ADD COLUMN ... NOT NULL DEFAULT ...` empat kali. Tidak ada `DROP`.

- [ ] **Step 3: Tulis test yang gagal**

Tambahkan ke `src/lib/inbound.test.ts`:

```ts
describe('defaultBotEnabled per platform', () => {
  it('memakai sakelar WhatsApp untuk percakapan WhatsApp', async () => {
    mockPrisma.settings.findUniqueOrThrow.mockResolvedValue({
      botAutoReplyAll: true, skipBotForIndonesianNumbers: false,
      botEnabledWhatsapp: false, botEnabledFacebook: true,
      botEnabledInstagram: false, botEnabledEmail: false,
    } as never)

    await expect(defaultBotEnabled({ platform: 'WHATSAPP', phone: '491234567' })).resolves.toBe(false)
  })

  it('memakai sakelar Facebook untuk percakapan Facebook', async () => {
    mockPrisma.settings.findUniqueOrThrow.mockResolvedValue({
      botAutoReplyAll: true, skipBotForIndonesianNumbers: false,
      botEnabledWhatsapp: false, botEnabledFacebook: true,
      botEnabledInstagram: false, botEnabledEmail: false,
    } as never)

    await expect(defaultBotEnabled({ platform: 'FACEBOOK', phone: null })).resolves.toBe(true)
  })

  // Tanpa penjagaan hasPhoneNumber(), PSID Facebook berupa angka panjang bisa lolos ke
  // regex /^62\d+$/ kalau suatu saat regexnya dilonggarkan -- dan filter nomor Indonesia
  // akan diam-diam mematikan bot di channel yang sama sekali tidak punya nomor telepon.
  it('filter nomor Indonesia tidak pernah berlaku di platform non-telepon', async () => {
    mockPrisma.settings.findUniqueOrThrow.mockResolvedValue({
      botAutoReplyAll: true, skipBotForIndonesianNumbers: true,
      botEnabledWhatsapp: true, botEnabledFacebook: true,
      botEnabledInstagram: true, botEnabledEmail: true,
    } as never)

    await expect(defaultBotEnabled({ platform: 'FACEBOOK', phone: '628123456789' })).resolves.toBe(true)
    await expect(defaultBotEnabled({ platform: 'WHATSAPP', phone: '628123456789' })).resolves.toBe(false)
  })
})
```

- [ ] **Step 4: Jalankan, pastikan gagal**

Run: `npm test -- src/lib/inbound.test.ts`
Expected: FAIL — `defaultBotEnabled` masih menerima string, bukan objek.

- [ ] **Step 5: Implementasi**

Ganti `defaultBotEnabled` di `src/lib/inbound.ts` (pertahankan komentar sejarah yang sudah ada, tambahkan alinea baru):

```ts
const TOGGLE_BY_PLATFORM = {
  WHATSAPP: 'botEnabledWhatsapp',
  INSTAGRAM: 'botEnabledInstagram',
  FACEBOOK: 'botEnabledFacebook',
  EMAIL: 'botEnabledEmail',
} as const satisfies Record<Platform, keyof Settings>

export async function defaultBotEnabled(input: { platform: Platform; phone: string | null }): Promise<boolean> {
  const settings = await prisma.settings.findUniqueOrThrow({ where: { id: 1 } })

  // Filter nomor Indonesia hanya punya arti di platform yang identitasnya memang nomor
  // telepon. Dijaga eksplisit lewat hasPhoneNumber(), bukan dibiarkan gagal sendiri karena
  // regexnya kebetulan tidak cocok dengan IGSID/PSID -- lihat src/lib/channel/platform.ts.
  if (hasPhoneNumber(input.platform) && input.phone && isIndonesianNumber(input.phone) && settings.skipBotForIndonesianNumbers) {
    return false
  }

  return settings[TOGGLE_BY_PLATFORM[input.platform]]
}
```

Tambahkan import `Platform` dan `Settings` dari `@prisma/client` serta `hasPhoneNumber` dari `@/lib/channel/platform`.

Perbarui kedua pemanggil di `inbound.ts` menjadi `defaultBotEnabled({ platform: 'WHATSAPP', phone: contact.phone })`, dan pemanggil di `src/lib/system-templates/send.ts:147` menjadi `defaultBotEnabled({ platform: 'WHATSAPP', phone })`.

- [ ] **Step 6: Jalankan, pastikan lulus**

Run: `npm test && npx tsc --noEmit && npx eslint .`
Expected: semua lulus. Test lama `defaultBotEnabled` yang memakai `botAutoReplyAll` mungkin perlu disesuaikan ke `botEnabledWhatsapp` — sesuaikan, jangan hapus.

- [ ] **Step 7: Commit**

```bash
git add prisma/ src/lib/inbound.ts src/lib/inbound.test.ts src/lib/system-templates/send.ts
git commit -m "feat(bot): sakelar autoreply per platform, filter +62 dijaga ke WhatsApp"
```

---

## Task 7: Route toggle per channel

**Files:**
- Create: `src/app/api/bot/channel-toggle/route.ts`
- Test: `src/app/api/bot/channel-toggle/route.test.ts`

**Interfaces:**
- Consumes: kolom `Settings` (Task 6)
- Produces: `POST /api/bot/channel-toggle` dengan body `{ platform: Platform }`, mengembalikan `{ platform, enabled }`.

- [ ] **Step 1: Tulis test yang gagal**

Create `src/app/api/bot/channel-toggle/route.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/require-admin'
import { writeBotAuditLog } from '@/lib/bot-control/audit'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: vi.fn() }))
vi.mock('@/lib/bot-control/audit', () => ({ writeBotAuditLog: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>
import { POST } from './route'

function req(body: unknown) {
  return new Request('http://t/api/bot/channel-toggle', { method: 'POST', body: JSON.stringify(body) })
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.mocked(requireAdmin).mockResolvedValue({ accountId: 'a1', role: 'ADMIN' } as never)
  vi.mocked(writeBotAuditLog).mockReset()
  mockPrisma.account.findUnique.mockResolvedValue({ name: 'Dave' } as never)
})

describe('POST /api/bot/channel-toggle', () => {
  it('menolak yang bukan admin dengan 403', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(null)
    const res = await POST(req({ platform: 'FACEBOOK' }))
    expect(res.status).toBe(403)
    expect(mockPrisma.settings.update).not.toHaveBeenCalled()
  })

  it('menolak platform yang tidak dikenal dengan 400', async () => {
    const res = await POST(req({ platform: 'TIKTOK' }))
    expect(res.status).toBe(400)
    expect(mockPrisma.settings.update).not.toHaveBeenCalled()
  })

  // Inti desainnya: sakelar adalah PENULIS MASSAL, bukan gerbang kedua. Kalau updateMany
  // ini hilang, sakelar hanya berlaku untuk percakapan baru dan operator akan melihat
  // toggle menyala sementara chat-chat lama tetap diam.
  it('menulis massal botEnabled ke percakapan platform itu saja', async () => {
    mockPrisma.settings.findUniqueOrThrow.mockResolvedValue({ botEnabledFacebook: false } as never)
    mockPrisma.settings.update.mockResolvedValue({ botEnabledFacebook: true } as never)

    await POST(req({ platform: 'FACEBOOK' }))

    expect(mockPrisma.conversation.updateMany).toHaveBeenCalledWith({
      where: { channelIdentity: { platform: 'FACEBOOK' } },
      data: { botEnabled: true },
    })
  })

  it('mencatat audit log dengan aksi ENABLE saat dinyalakan', async () => {
    mockPrisma.settings.findUniqueOrThrow.mockResolvedValue({ botEnabledInstagram: false } as never)
    mockPrisma.settings.update.mockResolvedValue({ botEnabledInstagram: true } as never)

    await POST(req({ platform: 'INSTAGRAM' }))

    expect(writeBotAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'ENABLE', entityType: 'BOT_SETTING', entityKey: 'botEnabledInstagram',
    }))
  })
})
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `npm test -- src/app/api/bot/channel-toggle/route.test.ts`
Expected: FAIL — `Failed to resolve import "./route"`.

- [ ] **Step 3: Implementasi**

Create `src/app/api/bot/channel-toggle/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { Platform } from '@prisma/client'
import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/require-admin'
import { writeBotAuditLog } from '@/lib/bot-control/audit'

/**
 * Sakelar autoreply bot per platform.
 *
 * Meniru /api/bot/mode: ia PENULIS MASSAL, bukan gerbang runtime kedua. Gerbang saat pesan
 * masuk tetap satu -- Conversation.botEnabled. Kalau sakelar ini dibuat sebagai gerbang
 * tambahan yang di-AND-kan, mematikan lalu menyalakan sebuah channel tidak akan benar-benar
 * menghidupkan chat-chatnya, dan "Ambil Alih dari Bot" per chat bisa tertimpa diam-diam.
 *
 * Konsekuensi yang diterima sadar: menyalakan ulang sebuah channel MENGHAPUS override
 * per-chat di channel itu -- preseden "bulk write always wins" yang sama dengan sakelar global.
 */
const TOGGLE_BY_PLATFORM = {
  WHATSAPP: 'botEnabledWhatsapp',
  INSTAGRAM: 'botEnabledInstagram',
  FACEBOOK: 'botEnabledFacebook',
  EMAIL: 'botEnabledEmail',
} as const

const bodySchema = z.object({
  platform: z.enum(['WHATSAPP', 'INSTAGRAM', 'FACEBOOK', 'EMAIL']),
})

export async function POST(req: Request) {
  const admin = await requireAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Hanya admin yang bisa mengubah sakelar channel' }, { status: 403 })

  try {
    const parsed = bodySchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json({ error: 'Platform tidak dikenal' }, { status: 400 })

    const platform: Platform = parsed.data.platform
    const column = TOGGLE_BY_PLATFORM[platform]

    const current = await prisma.settings.findUniqueOrThrow({ where: { id: 1 } })
    const next = !current[column]
    const updated = await prisma.settings.update({ where: { id: 1 }, data: { [column]: next } })

    await prisma.conversation.updateMany({
      where: { channelIdentity: { platform } },
      data: { botEnabled: next },
    })

    const actor = await prisma.account.findUnique({ where: { id: admin.accountId }, select: { name: true } })
    await writeBotAuditLog({
      action: next ? 'ENABLE' : 'DISABLE',
      entityType: 'BOT_SETTING',
      entityKey: column,
      actorId: admin.accountId,
      actorName: actor?.name ?? null,
    })

    return NextResponse.json({ platform, enabled: updated[column] })
  } catch {
    return NextResponse.json({ error: 'Gagal mengubah sakelar channel' }, { status: 500 })
  }
}
```

- [ ] **Step 4: Jalankan, pastikan lulus**

Run: `npm test -- src/app/api/bot/channel-toggle/route.test.ts`
Expected: PASS (4 test).

- [ ] **Step 5: Verifikasi penuh dan commit**

```bash
npm test && npx tsc --noEmit && npx eslint .
git add src/app/api/bot/channel-toggle/
git commit -m "feat(api): route sakelar bot per channel"
```

---

## Task 8: Empat toggle di halaman /chatbot

**Files:**
- Modify: `src/app/(authenticated)/chatbot/page.tsx`

**Interfaces:**
- Consumes: `POST /api/bot/channel-toggle` (Task 7)
- Produces: —

- [ ] **Step 1: Baca pola yang sudah ada**

Buka `src/app/(authenticated)/chatbot/page.tsx` baris 280-310. Di sana ada `Badge` + `Button` untuk `botAutoReplyAll` yang memanggil `/api/bot/mode`. Tiru bentuknya persis: `Badge variant={... ? 'success' : 'warning'}` dan `Button variant={... ? 'destructive' : 'outline'}`.

- [ ] **Step 2: Tambahkan empat kolom ke tipe settings**

Pada interface settings di kepala file (sekitar baris 23, tempat `botAutoReplyAll: boolean`):

```ts
  botEnabledWhatsapp: boolean
  botEnabledInstagram: boolean
  botEnabledFacebook: boolean
  botEnabledEmail: boolean
```

- [ ] **Step 3: Tambahkan handler**

```tsx
  const PLATFORM_LABELS = {
    WHATSAPP: { label: 'WhatsApp', key: 'botEnabledWhatsapp' },
    INSTAGRAM: { label: 'Instagram', key: 'botEnabledInstagram' },
    FACEBOOK: { label: 'Facebook', key: 'botEnabledFacebook' },
    EMAIL: { label: 'Email', key: 'botEnabledEmail' },
  } as const

  async function toggleChannel(platform: keyof typeof PLATFORM_LABELS) {
    const { enabled } = await fetchJson<{ platform: string; enabled: boolean }>(
      '/api/bot/channel-toggle',
      { method: 'POST', body: JSON.stringify({ platform }) },
    )
    const key = PLATFORM_LABELS[platform].key
    setSettings((prev) => (prev ? { ...prev, [key]: enabled } : prev))
  }
```

- [ ] **Step 4: Render empat toggle**

```tsx
  <div className="mt-4 space-y-2">
    {(Object.keys(PLATFORM_LABELS) as Array<keyof typeof PLATFORM_LABELS>).map((p) => {
      const { label, key } = PLATFORM_LABELS[p]
      const on = settings[key]
      return (
        <div key={p} className="flex items-center justify-between gap-3">
          <span className="text-sm">{label}</span>
          <div className="flex items-center gap-2">
            <Badge variant={on ? 'success' : 'warning'}>Bot: {on ? 'On' : 'Off'}</Badge>
            <Button size="sm" variant={on ? 'destructive' : 'outline'} onClick={() => toggleChannel(p)}>
              {on ? 'Matikan' : 'Aktifkan'}
            </Button>
          </div>
        </div>
      )
    })}
  </div>
```

- [ ] **Step 5: Verifikasi build klien**

```bash
npm run build
```

Expected: exit 0. Ini langkah yang tidak boleh dilewati — `tsc` dan `eslint` tidak menangkap kerusakan bundle klien.

- [ ] **Step 6: Commit**

```bash
npm test && npx tsc --noEmit && npx eslint .
git add "src/app/(authenticated)/chatbot/page.tsx"
git commit -m "feat(ui): empat toggle sakelar bot per channel di /chatbot"
```

---

## Task 9: Longgarkan constraint identitas (langkah terakhir, non-aditif)

**BERHENTI DAN MINTA PERSETUJUAN OPERATOR SEBELUM MEMULAI TASK INI.** CLAUDE.md §7 mewajibkan `ALTER TABLE` non-aditif didiskusikan lebih dulu.

Task 1-8 harus sudah ter-deploy, dan `SELECT` Task 5 Step 5 harus menunjukkan `belum_tertaut = 0`.

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260924110000_relax_identity_constraints/migration.sql`

**Interfaces:**
- Consumes: backfill selesai (Task 5)
- Produces: `Contact.phone` boleh null dan tidak unik; satu `Contact` boleh punya banyak `Conversation`.

- [ ] **Step 1: Longgarkan dua kunci di schema**

Pada `model Contact`, ubah:

```prisma
  // phone String @unique  -->  dilonggarkan:
  /// Nomor WhatsApp. Null untuk kontak yang lahir dari channel tanpa nomor (IG/FB/email).
  /// Identitas yang sesungguhnya ada di ChannelIdentity; kolom ini dipertahankan sebagai
  /// kolom denormalisasi supaya kueri filter nomor Indonesia di
  /// src/app/api/bot/indonesia-filter/route.ts tetap jalan tanpa diubah.
  phone String?
```

Pada `model Conversation`, ubah `contactId String @unique` menjadi `contactId String` dan tambahkan `@@index([contactId])`.

- [ ] **Step 2: Buat migrasi dan PERIKSA SQL-nya baris per baris**

```bash
git show HEAD:prisma/schema.prisma > /tmp/schema-lama.prisma
npx prisma migrate diff --from-schema /tmp/schema-lama.prisma \
  --to-schema prisma/schema.prisma --script > /tmp/m.sql
cat /tmp/m.sql
```

Expected — **persis** ini, tidak lebih:

```sql
DROP INDEX "Contact_phone_key";
DROP INDEX "Conversation_contactId_key";
ALTER TABLE "Contact" ALTER COLUMN "phone" DROP NOT NULL;
CREATE INDEX "Conversation_contactId_idx" ON "Conversation"("contactId");
```

**GAGALKAN task ini kalau ada `DROP TABLE`, `DROP COLUMN`, atau `TRUNCATE`.** Melepas index dan melepas NOT NULL tidak menghapus satu baris pun; `DROP COLUMN` menghapus.

- [ ] **Step 3: Cadangkan lagi, lalu terapkan**

```bash
ssh root@31.97.223.43 "pg_dump -U <user> -d <db> -F c -f /root/backup-pre-relax-$(date +%F).dump"
mkdir -p prisma/migrations/20260924110000_relax_identity_constraints
cp /tmp/m.sql prisma/migrations/20260924110000_relax_identity_constraints/migration.sql
npx prisma generate
```

- [ ] **Step 4: Verifikasi seluruh suite**

Run: `npm test && npx tsc --noEmit && npx eslint . && npm run build`
Expected: semua lulus. Kalau ada test yang mengandalkan `contactId` unik, perbaiki testnya — bukan schemanya.

- [ ] **Step 5: Commit dan deploy**

```bash
git add prisma/
git commit -m "feat(schema): longgarkan Contact.phone dan Conversation.contactId untuk multi-channel"
```

Deploy ke VPS, `npx prisma migrate deploy`, lalu:

```bash
ssh root@31.97.223.43 "psql -U <user> -d <db> -c '
  SELECT (SELECT count(*) FROM \"Contact\") AS kontak,
         (SELECT count(*) FROM \"Conversation\") AS percakapan;'"
curl -sI https://<domain produksi> | head -1
```

Expected: kedua angka **sama persis** dengan Task 5 Step 5, dan `HTTP/2 200`.

---

## Selesai

Fondasi siap. Database tidak lagi memaksa "satu manusia = satu nomor = satu benang", dan empat sakelar bot sudah ada — tiga di antaranya mengendalikan channel yang belum dibangun, dan itu memang disengaja.

Lanjut ke `docs/superpowers/plans/2026-09-23-omnichannel-facebook.md`.

# Facebook Messenger — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pesan Facebook Messenger masuk ke wa-inbox, terbaca di tab Facebook, dan bisa dibalas dari sana — dengan sakelar bot Facebook yang sudah dibangun di fase fondasi.

**Architecture:** Endpoint webhook Meta yang sudah ada dipakai ulang tanpa perubahan pada verifikasi signature; yang ditambah hanya percabangan `payload.object`. Payload Messenger berbentuk `entry[].messaging[]`, berbeda dari WhatsApp yang `entry[].changes[].value.messages[]`, jadi ia mendapat parser sendiri yang bermuara ke `ChannelIdentity(FACEBOOK, PSID)`. Pengiriman lewat Graph API Page, dipasang sebagai cabang platform **di atas** percabangan `OFFICIAL`/`UNOFFICIAL` yang sudah ada.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Prisma 7, PostgreSQL, Vitest + `vitest-mock-extended`, Meta Graph API.

**Spec:** `docs/superpowers/specs/2026-09-23-omnichannel-inbox-design.md`

**Prasyarat:** `docs/superpowers/plans/2026-09-23-omnichannel-fondasi.md` **selesai dan ter-deploy seluruhnya** — termasuk Task 5b (pindah kunci upsert) dan Task 9 (pelonggaran constraint). Tanpa Task 9, `Contact` tanpa nomor telepon tidak bisa dibuat sama sekali; tanpa Task 5b, ingest WhatsApp sudah patah sebelum Facebook disentuh. Task 1 di bawah memeriksa keduanya sebelum apa pun ditulis.

**Catatan placeholder:** `<user>`, `<db>`, `<domain produksi>`, `<page id>`, dan `<token>` sengaja tidak diisi. Kredensial tidak boleh ditulis ke dokumen mana pun (CLAUDE.md §5); ambil nilainya dari `.env` VPS saat menjalankan perintahnya.

## Global Constraints

Sama persis dengan plan fondasi — semuanya tetap berlaku:

- **Dilarang `any`.** Pakai `unknown` atau tipe yang sesuai.
- **Dilarang `npx prisma migrate dev`** terhadap database produksi.
- **Migrasi produksi dibuat offline** lewat `prisma migrate diff`, diperiksa, lalu `prisma migrate deploy`.
- **Sebelum tiap commit:** `npm test`, `npx tsc --noEmit`, `npx eslint .`.
- **Sebelum deploy VPS:** `npm run build` lokal dulu.
- **Deploy VPS:** export PATH nvm Node 22.
- **`MessageChannel { OFFICIAL, UNOFFICIAL }` tidak boleh disentuh.**
- **Jangan pernah menampilkan token/API key** di UI, API response, audit log, atau dokumen ekspor apa pun.
- **Jangan uji ke akun pelanggan sungguhan.** Uji hanya ke akun Facebook milik tim sendiri.
- Menjalankan satu file test: `npm test -- <path>`.

---

## File Structure

**Dibuat:**
- `src/lib/meta/messenger-types.ts` — tipe payload `entry[].messaging[]`
- `src/lib/meta/messenger-send.ts` — `sendMessengerText()`
- `src/lib/meta/messenger-send.test.ts`
- `src/lib/inbound-messenger.ts` — parser + ingest Messenger
- `src/lib/inbound-messenger.test.ts`

**Diubah:**
- `src/lib/inbound.ts` — percabangan `payload.object` di `ingestMetaMessage`
- `src/lib/send.ts` — cabang platform di atas cabang `MessageChannel`
- `src/components/inbox/ConversationList.tsx` — tab platform
- `src/app/api/conversations/route.ts` — filter `platform`

**Tidak disentuh sama sekali:** `src/lib/meta/webhook-verify.ts`, `src/app/api/webhooks/meta/route.ts`, `src/lib/outbound/worker.ts`, `src/lib/bot/orchestrator.ts`.

---

## Task 0: Ajukan App Review Meta (non-kode — kerjakan HARI PERTAMA, paralel)

Ini satu-satunya pekerjaan di plan ini yang latensinya di luar kendali kode. Ajukan sekarang, lalu kerjakan Task 1 dst. sambil menunggu.

- [ ] **Step 1: Kumpulkan yang dibutuhkan**

Di [developers.facebook.com](https://developers.facebook.com) pada app Meta yang sama dengan WhatsApp Cloud API JVTO:
- Tambahkan produk **Messenger**.
- Tautkan Facebook Page JVTO.
- Catat **Page ID** dan buat **Page Access Token** berumur panjang.
- Ajukan Advanced Access untuk permission **`pages_messaging`**.

- [ ] **Step 2: Daftarkan webhook Messenger**

Callback URL: `https://<domain produksi>/api/webhooks/meta` — **URL yang sama persis dengan WhatsApp**. Verify token sama. App secret sama, jadi `verifyMetaSignature` tidak perlu diubah sama sekali.

Subscribe field: `messages`, `messaging_postbacks`.

- [ ] **Step 3: Simpan kredensial sebagai environment variable di VPS**

```
FB_PAGE_ID=<page id>
FB_PAGE_ACCESS_TOKEN=<token>
```

Disimpan sebagai env var, bukan kolom database seperti `WaNumber`, karena JVTO punya **satu** Page dan tidak akan punya lebih — CLAUDE.md §1. Token ini tidak boleh pernah muncul di UI, API response, atau audit log.

- [ ] **Step 4: Catat statusnya**

Tulis tanggal pengajuan di plan ini. Task 1-5 bisa jalan penuh tanpa persetujuan (Meta mengizinkan pengujian ke akun yang punya peran di app). Hanya Task 6 (uji dengan akun luar) yang menunggu Advanced Access.

---

## Task 1: Verifikasi prasyarat fondasi

Tidak ada kode di task ini. Tujuannya memastikan fondasi benar-benar selesai, karena tiga hal di bawah **mustahil dikerjakan** tanpanya dan kegagalannya tidak selalu kelihatan sebagai error yang jelas.

**Files:** —

**Interfaces:**
- Consumes: seluruh plan fondasi
- Produces: —

- [ ] **Step 1: `Contact.phone` sudah boleh null**

```bash
cd /Users/macbook/Code/wa-inbox
grep -nE "phone\s+String\??" prisma/schema.prisma
```

Expected: `phone String?` — **tanpa** `@unique`. Kalau masih `phone String @unique`, fondasi Task 9 belum jalan dan `Contact` Facebook (yang tidak punya nomor) tidak akan bisa dibuat sama sekali.

- [ ] **Step 2: Kunci benang sudah terpasang dan terpakai**

```bash
grep -n "externalThreadId" prisma/schema.prisma src/lib/inbound.ts
```

Expected: kolom `externalThreadId` ada di schema, `@@unique([channelIdentityId, externalThreadId])` ada, dan `src/lib/inbound.ts` sudah memakai `channelIdentityId_externalThreadId` sebagai `where` upsert-nya (fondasi Task 5b). Kalau `inbound.ts` masih `where: { contactId }`, **berhenti** — fondasinya belum tuntas.

- [ ] **Step 3: Sakelar bot Facebook sudah ada**

```bash
grep -n "botEnabledFacebook" prisma/schema.prisma src/app/api/bot/channel-toggle/route.ts
```

Expected: keduanya ketemu.

- [ ] **Step 4: Backfill tuntas di produksi**

```bash
ssh root@31.97.223.43 "psql -U <user> -d <db> -c '
  SELECT count(*) AS belum_tertaut FROM \"Conversation\" WHERE \"channelIdentityId\" IS NULL;'"
```

Expected: **0**. Kalau bukan 0, percakapan WhatsApp lama belum punya identitas dan tab platform akan menyembunyikannya dari pandangan tim.

---

## Task 2: Tipe payload Messenger

**Files:**
- Create: `src/lib/meta/messenger-types.ts`

**Interfaces:**
- Consumes: —
- Produces: `MessengerWebhookEntry`, `MessengerMessagingEvent`, type guard `isMessengerPayload(payload: unknown): boolean`

- [ ] **Step 1: Buat file tipe**

Create `src/lib/meta/messenger-types.ts`:

```ts
/**
 * Bentuk payload webhook Messenger dan Instagram DM.
 *
 * Berbeda dari WhatsApp: WhatsApp membungkus pesan di `entry[].changes[].value.messages[]`,
 * Messenger dan Instagram DM memakai `entry[].messaging[]` tanpa lapisan `changes` sama sekali.
 * Loop WhatsApp yang ada di src/lib/inbound.ts tidak akan pernah melihat pesan ini -- ia
 * membaca `entry.changes` yang di payload ini tidak ada, jadi pesannya lolos verifikasi
 * signature lalu dibuang diam-diam sambil endpoint tetap membalas 200.
 */
export interface MessengerMessagingEvent {
  sender: { id: string }
  recipient: { id: string }
  timestamp: number
  message?: {
    mid: string
    text?: string
    is_echo?: boolean
    attachments?: Array<{ type: string; payload?: { url?: string } }>
  }
}

export interface MessengerWebhookEntry {
  id: string
  time: number
  messaging?: MessengerMessagingEvent[]
}

export interface MessengerWebhookPayload {
  object: 'page' | 'instagram'
  entry?: MessengerWebhookEntry[]
}

export function isMessengerPayload(payload: unknown): payload is MessengerWebhookPayload {
  if (typeof payload !== 'object' || payload === null) return false
  const object = (payload as { object?: unknown }).object
  return object === 'page' || object === 'instagram'
}
```

- [ ] **Step 2: Verifikasi kompilasi**

Run: `npx tsc --noEmit && npx eslint .`
Expected: lulus.

- [ ] **Step 3: Commit**

```bash
git add src/lib/meta/messenger-types.ts
git commit -m "feat(meta): tipe payload Messenger/Instagram entry[].messaging[]"
```

---

## Task 3: Ingest Messenger

**Files:**
- Create: `src/lib/inbound-messenger.ts`
- Test: `src/lib/inbound-messenger.test.ts`

**Interfaces:**
- Consumes: `upsertChannelIdentity` (fondasi Task 3), `defaultBotEnabled` (fondasi Task 6), tipe dari Task 2
- Produces:
  ```ts
  ingestMessengerPayload(
    payload: MessengerWebhookPayload,
    platform: 'FACEBOOK' | 'INSTAGRAM',
  ): Promise<{ processed: number; skipped: number }>
  ```

- [ ] **Step 1: Tulis test yang gagal**

Create `src/lib/inbound-messenger.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { upsertChannelIdentity } from '@/lib/channel/identity'
import type { MessengerWebhookPayload } from '@/lib/meta/messenger-types'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/channel/identity', () => ({ upsertChannelIdentity: vi.fn() }))
vi.mock('@/lib/realtime', () => ({ broadcast: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>
import { ingestMessengerPayload } from './inbound-messenger'

const payload: MessengerWebhookPayload = {
  object: 'page',
  entry: [{
    id: 'page_1',
    time: 1758000000000,
    messaging: [{
      sender: { id: 'psid_abc' },
      recipient: { id: 'page_1' },
      timestamp: 1758000000000,
      message: { mid: 'm_fb_1', text: 'Halo, masih ada slot Bromo?' },
    }],
  }],
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.mocked(upsertChannelIdentity).mockReset().mockResolvedValue({ id: 'ci_fb_1', contactId: 'contact_fb_1' })
  mockPrisma.message.findUnique.mockResolvedValue(null as never)
  mockPrisma.contact.create.mockResolvedValue({ id: 'contact_fb_1', phone: null } as never)
  mockPrisma.conversation.upsert.mockResolvedValue({ id: 'conv_fb_1', botEnabled: false } as never)
  mockPrisma.message.create.mockResolvedValue({ id: 'msg_fb_1' } as never)
  mockPrisma.settings.findUniqueOrThrow.mockResolvedValue({
    botEnabledFacebook: false, skipBotForIndonesianNumbers: false,
  } as never)
})

describe('ingestMessengerPayload', () => {
  it('menyimpan pesan masuk dan menghitungnya sebagai processed', async () => {
    const result = await ingestMessengerPayload(payload, 'FACEBOOK')
    expect(result).toEqual({ processed: 1, skipped: 0 })
    expect(mockPrisma.message.create).toHaveBeenCalled()
  })

  it('memakai PSID sebagai externalId identitas Facebook', async () => {
    await ingestMessengerPayload(payload, 'FACEBOOK')
    expect(upsertChannelIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ platform: 'FACEBOOK', externalId: 'psid_abc' }),
    )
  })

  // Contact Facebook TIDAK punya nomor telepon. Sebelum fondasi Task 9 melonggarkan
  // Contact.phone jadi nullable, baris seperti ini mustahil dibuat sama sekali.
  it('membuat Contact tanpa nomor telepon', async () => {
    await ingestMessengerPayload(payload, 'FACEBOOK')
    const arg = mockPrisma.contact.create.mock.calls[0][0]
    expect(arg.data.phone ?? null).toBeNull()
  })

  // externalId Meta ditulis ke kolom Message.externalId yang @unique -- kolom yang sama
  // dipakai WhatsApp. Tanpa ini, Meta yang mengirim ulang webhook (hal normal) akan
  // menggandakan pesan di layar agen.
  it('melewati pesan yang sudah pernah masuk', async () => {
    mockPrisma.message.findUnique.mockResolvedValue({ id: 'msg_fb_1' } as never)
    const result = await ingestMessengerPayload(payload, 'FACEBOOK')
    expect(result).toEqual({ processed: 0, skipped: 1 })
    expect(mockPrisma.message.create).not.toHaveBeenCalled()
  })

  // Echo adalah salinan pesan yang KITA kirim, dipantulkan balik oleh Meta. Kalau ikut
  // diproses sebagai pesan masuk, bot akan menjawab dirinya sendiri.
  it('mengabaikan echo pesan kita sendiri', async () => {
    const echo: MessengerWebhookPayload = {
      object: 'page',
      entry: [{ id: 'page_1', time: 1, messaging: [{
        sender: { id: 'page_1' }, recipient: { id: 'psid_abc' }, timestamp: 1,
        message: { mid: 'm_echo', text: 'balasan kami', is_echo: true },
      }] }],
    }
    const result = await ingestMessengerPayload(echo, 'FACEBOOK')
    expect(result).toEqual({ processed: 0, skipped: 1 })
    expect(mockPrisma.message.create).not.toHaveBeenCalled()
  })

  it('mengunci benang dengan externalThreadId kosong (satu akun = satu percakapan)', async () => {
    await ingestMessengerPayload(payload, 'FACEBOOK')
    const arg = mockPrisma.conversation.upsert.mock.calls[0][0]
    expect(arg.where).toEqual({
      channelIdentityId_externalThreadId: { channelIdentityId: 'ci_fb_1', externalThreadId: '' },
    })
  })
})
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `npm test -- src/lib/inbound-messenger.test.ts`
Expected: FAIL — `Failed to resolve import "./inbound-messenger"`.

- [ ] **Step 3: Implementasi**

Create `src/lib/inbound-messenger.ts`:

```ts
import type { Platform } from '@prisma/client'
import { prisma } from '@/lib/db'
import { upsertChannelIdentity } from '@/lib/channel/identity'
import { defaultBotEnabled } from '@/lib/inbound'
import { broadcast } from '@/lib/realtime'
import type { MessengerMessagingEvent, MessengerWebhookPayload } from '@/lib/meta/messenger-types'

/**
 * Ingest pesan Messenger dan Instagram DM.
 *
 * Satu fungsi untuk dua platform, dengan `platform` sebagai parameter, karena payload
 * keduanya identik: Meta memakai bentuk `entry[].messaging[]` yang sama untuk Page dan
 * Instagram. Memecahnya jadi dua file berarti dua tempat yang harus diperbaiki setiap kali
 * Meta mengubah bentuknya, dan dua tempat yang bisa berbeda diam-diam.
 */
export async function ingestMessengerPayload(
  payload: MessengerWebhookPayload,
  platform: Extract<Platform, 'FACEBOOK' | 'INSTAGRAM'>,
): Promise<{ processed: number; skipped: number }> {
  let processed = 0
  let skipped = 0

  for (const entry of payload.entry ?? []) {
    for (const event of entry.messaging ?? []) {
      if (await ingestOne(event, platform)) processed += 1
      else skipped += 1
    }
  }

  return { processed, skipped }
}

async function ingestOne(
  event: MessengerMessagingEvent,
  platform: Extract<Platform, 'FACEBOOK' | 'INSTAGRAM'>,
): Promise<boolean> {
  const message = event.message
  if (!message) return false

  // Echo adalah salinan pesan yang kita kirim sendiri, dipantulkan Meta. Memprosesnya
  // sebagai pesan masuk membuat bot menjawab dirinya sendiri.
  if (message.is_echo) return false

  const text = message.text?.trim()
  if (!text) return false

  const existing = await prisma.message.findUnique({ where: { externalId: message.mid } })
  if (existing) return false

  const contact = await prisma.contact.create({ data: { phone: null, name: null } })

  const identity = await upsertChannelIdentity({
    platform,
    externalId: event.sender.id,
    contactId: contact.id,
  })

  const sentAt = new Date(event.timestamp)

  const conversation = await prisma.conversation.upsert({
    where: {
      channelIdentityId_externalThreadId: { channelIdentityId: identity.id, externalThreadId: '' },
    },
    update: { lastMessageAt: sentAt },
    create: {
      contactId: identity.contactId,
      channelIdentityId: identity.id,
      externalThreadId: '',
      lastMessageAt: sentAt,
      botEnabled: await defaultBotEnabled({ platform, phone: null }),
    },
  })

  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      externalId: message.mid,
      direction: 'INBOUND',
      type: 'text',
      content: text,
      channel: 'OFFICIAL',
      sentBy: 'CUSTOMER',
    },
  })

  broadcast({ type: 'message.new', conversationId: conversation.id })
  return true
}
```

- [ ] **Step 4: Jalankan, pastikan lulus**

Run: `npm test -- src/lib/inbound-messenger.test.ts`
Expected: PASS (6 test).

Kalau `broadcast` menolak bentuk event itu, baca `src/lib/realtime.ts` dan pakai bentuk yang benar-benar dipakai `src/lib/inbound.ts` — jangan karang bentuk baru.

- [ ] **Step 5: Commit**

```bash
npm test && npx tsc --noEmit && npx eslint .
git add src/lib/inbound-messenger.ts src/lib/inbound-messenger.test.ts
git commit -m "feat(inbound): ingest Messenger/Instagram DM entry[].messaging[]"
```

---

## Task 4: Percabangan `payload.object` di webhook

**Files:**
- Modify: `src/lib/inbound.ts` (fungsi `ingestMetaMessage`, sekitar baris 731-766)
- Test: `src/lib/inbound.test.ts`

**Interfaces:**
- Consumes: `ingestMessengerPayload` (Task 3), `isMessengerPayload` (Task 2)
- Produces: `ingestMetaMessage` merutekan berdasarkan `payload.object`.

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan ke `src/lib/inbound.test.ts`:

```ts
describe('perutean payload.object', () => {
  it('meneruskan payload page ke ingest Messenger', async () => {
    const spy = vi.mocked(ingestMessengerPayload).mockResolvedValue({ processed: 1, skipped: 0 })
    await ingestMetaMessage({ object: 'page', entry: [] } as never)
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ object: 'page' }), 'FACEBOOK')
  })

  it('meneruskan payload instagram ke ingest Messenger dengan platform INSTAGRAM', async () => {
    const spy = vi.mocked(ingestMessengerPayload).mockResolvedValue({ processed: 1, skipped: 0 })
    await ingestMetaMessage({ object: 'instagram', entry: [] } as never)
    expect(spy).toHaveBeenCalledWith(expect.anything(), 'INSTAGRAM')
  })

  // Penjaga regresi: jalur WhatsApp tidak boleh ikut berubah bentuk.
  it('payload WhatsApp tetap lewat jalur changes[].value.messages[]', async () => {
    stubHappyPath()
    const result = await ingestMetaMessage(samplePayload)
    expect(result.processed).toBe(1)
    expect(vi.mocked(ingestMessengerPayload)).not.toHaveBeenCalled()
  })
})
```

Tambahkan juga mock di kepala file:

```ts
vi.mock('@/lib/inbound-messenger', () => ({ ingestMessengerPayload: vi.fn() }))
```

dan import `ingestMessengerPayload` dari `@/lib/inbound-messenger`.

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `npm test -- src/lib/inbound.test.ts`
Expected: FAIL — `ingestMessengerPayload` tidak pernah dipanggil.

- [ ] **Step 3: Implementasi**

Di `src/lib/inbound.ts`, tambahkan import:

```ts
import { ingestMessengerPayload } from '@/lib/inbound-messenger'
import { isMessengerPayload } from '@/lib/meta/messenger-types'
```

Di awal `ingestMetaMessage`, sebelum loop `for (const entry of payload.entry ?? [])`:

```ts
  // Meta memakai SATU endpoint webhook dan SATU app secret untuk WhatsApp, Page, dan
  // Instagram -- yang membedakan hanya `payload.object`. Sebelum percabangan ini ada,
  // payload Page/Instagram lolos verifikasi signature lalu jatuh ke loop `entry.changes`
  // yang di bentuk itu tidak ada, jadi pesannya hilang tanpa jejak sementara endpoint
  // tetap membalas 200 dan Meta menganggap pengirimannya berhasil.
  if (isMessengerPayload(payload)) {
    const platform = payload.object === 'instagram' ? 'INSTAGRAM' : 'FACEBOOK'
    const res = await ingestMessengerPayload(payload, platform)
    return { ...EMPTY_INGEST_RESULT, processed: res.processed, skipped: res.skipped }
  }
```

Definisikan konstanta di dekat kepala file:

```ts
const EMPTY_INGEST_RESULT = {
  processed: 0, skipped: 0, statusUpdates: 0, templateStatusUpdates: 0, echoed: 0,
} as const
```

Ubah tanda tangan `ingestMetaMessage` agar menerima `MetaWebhookPayload | MessengerWebhookPayload`.

- [ ] **Step 4: Jalankan, pastikan lulus**

Run: `npm test && npx tsc --noEmit && npx eslint .`
Expected: semua lulus, termasuk penjaga regresi WhatsApp.

- [ ] **Step 5: Commit**

```bash
git add src/lib/inbound.ts src/lib/inbound.test.ts
git commit -m "feat(webhook): rutekan payload.object ke WhatsApp / Messenger / Instagram"
```

---

## Task 5: Kirim ke Messenger

**Files:**
- Create: `src/lib/meta/messenger-send.ts`
- Test: `src/lib/meta/messenger-send.test.ts`
- Modify: `src/lib/send.ts`

**Interfaces:**
- Consumes: env `FB_PAGE_ACCESS_TOKEN` (Task 0)
- Produces: `sendMessengerText(recipientId: string, text: string): Promise<{ externalId: string }>`

- [ ] **Step 1: Tulis test yang gagal**

Create `src/lib/meta/messenger-send.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { sendMessengerText } from './messenger-send'

beforeEach(() => {
  vi.stubEnv('FB_PAGE_ACCESS_TOKEN', 'token-uji')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('sendMessengerText', () => {
  it('mengirim ke Graph API dan mengembalikan message id', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ message_id: 'm_out_1' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const res = await sendMessengerText('psid_abc', 'Halo!')

    expect(res).toEqual({ externalId: 'm_out_1' })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.recipient).toEqual({ id: 'psid_abc' })
    expect(body.message).toEqual({ text: 'Halo!' })
  })

  // Token tidak boleh pernah ikut ke pesan error yang bisa mendarat di UI atau audit log.
  it('tidak membocorkan token di pesan error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 400,
      json: async () => ({ error: { message: 'Invalid OAuth token token-uji', code: 190 } }),
    }))

    await expect(sendMessengerText('psid_abc', 'Halo!')).rejects.toThrow()
    await expect(sendMessengerText('psid_abc', 'Halo!')).rejects.not.toThrow(/token-uji/)
  })

  // Messenger menolak balasan di luar jendela 24 jam dengan error code 10. Tanpa pesan
  // yang bisa dibaca manusia, agen hanya melihat "gagal kirim" dan mencoba lagi berkali-kali
  // pada sesuatu yang tidak akan pernah berhasil.
  it('memberi pesan jelas saat di luar jendela 24 jam', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 400,
      json: async () => ({ error: { message: 'outside of the allowed window', code: 10 } }),
    }))

    await expect(sendMessengerText('psid_abc', 'Halo!')).rejects.toThrow(/24 jam/)
  })
})
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `npm test -- src/lib/meta/messenger-send.test.ts`
Expected: FAIL — modul belum ada.

- [ ] **Step 3: Implementasi**

Create `src/lib/meta/messenger-send.ts`:

```ts
const GRAPH_VERSION = 'v21.0'

/**
 * Kirim pesan teks ke satu PSID lewat Graph API Page.
 *
 * Pesan error dari Meta TIDAK pernah diteruskan mentah-mentah: Meta memantulkan token yang
 * dipakai ke dalam teks error OAuth-nya, dan teks itu bisa mendarat di UI atau audit log.
 * CLAUDE.md §5 melarang token muncul di mana pun.
 */
export async function sendMessengerText(
  recipientId: string,
  text: string,
): Promise<{ externalId: string }> {
  const token = process.env.FB_PAGE_ACCESS_TOKEN
  if (!token) throw new Error('FB_PAGE_ACCESS_TOKEN belum diatur')

  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/me/messages?access_token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { text },
      messaging_type: 'RESPONSE',
    }),
  })

  const data: unknown = await res.json()

  if (!res.ok) {
    const code = (data as { error?: { code?: number } }).error?.code
    // Code 10 = di luar jendela 24 jam. Mencoba lagi tidak akan pernah berhasil, jadi
    // agen harus tahu alasannya alih-alih menekan tombol kirim berulang kali.
    if (code === 10) {
      throw new Error('Facebook menolak: sudah lewat 24 jam sejak pesan terakhir pelanggan')
    }
    throw new Error(`Gagal mengirim ke Facebook (code ${code ?? res.status})`)
  }

  const messageId = (data as { message_id?: string }).message_id
  if (!messageId) throw new Error('Facebook tidak mengembalikan message_id')

  return { externalId: messageId }
}
```

- [ ] **Step 4: Jalankan, pastikan lulus**

Run: `npm test -- src/lib/meta/messenger-send.test.ts`
Expected: PASS (3 test).

- [ ] **Step 5: Sambungkan ke `send.ts`**

Di `src/lib/send.ts`, tambahkan cabang platform **di atas** percabangan `channel === 'OFFICIAL'` yang sudah ada — jangan ubah isi cabang WhatsApp:

```ts
  // Cabang platform duluan, baru cabang MessageChannel. MessageChannel { OFFICIAL,
  // UNOFFICIAL } berarti "Meta Cloud API vs wa-coexist" -- dua jalur DI DALAM WhatsApp,
  // bukan dua platform. Menjadikan FACEBOOK nilai ketiga di enum itu akan membuat worker
  // outbound salah memetakan provider.
  if (platform === 'FACEBOOK') {
    return sendMessengerText(recipientExternalId, text)
  }
```

Baca dulu tanda tangan `sendMessage` yang ada dan tambahkan `platform` sebagai parameter dengan default `'WHATSAPP'`, supaya seluruh pemanggil lama tidak perlu diubah.

- [ ] **Step 6: Verifikasi penuh dan commit**

```bash
npm test && npx tsc --noEmit && npx eslint .
git add src/lib/meta/messenger-send.ts src/lib/meta/messenger-send.test.ts src/lib/send.ts
git commit -m "feat(send): kirim pesan Messenger lewat Graph API Page"
```

---

## Task 6: Tab dan badge platform di Inbox

**Files:**
- Modify: `src/components/inbox/ConversationList.tsx`
- Modify: `src/app/api/conversations/route.ts`

**Interfaces:**
- Consumes: `Conversation.channelIdentity.platform`
- Produces: filter `?platform=FACEBOOK` pada `GET /api/conversations`

- [ ] **Step 1: Tambahkan varian filter**

`ConversationList.tsx` sudah punya pola ini (baris 15-30) — **tiru, jangan ganti**:

```ts
type FilterOption =
  | { kind: 'channel'; value: string }
  | { kind: 'label'; value: string }
  | { kind: 'platform'; value: string }
```

Di `conversationsUrl`, tambahkan satu baris sejajar dengan yang sudah ada:

```ts
  if (filter?.kind === 'platform') params.set('platform', filter.value)
```

- [ ] **Step 2: Render tab platform**

Di blok pill yang sudah ada (sekitar baris 275-315), tambahkan `.map()` bergaya sama. Default WhatsApp:

```tsx
  {(['WHATSAPP', 'INSTAGRAM', 'FACEBOOK', 'EMAIL'] as const).map((p) => {
    const active = sameFilter(filter, { kind: 'platform', value: p })
    return (
      <Button key={`platform:${p}`} type="button" size="sm"
        variant={active ? 'default' : 'outline'} aria-pressed={active}
        onClick={() => setFilter({ kind: 'platform', value: p })}>
        {PLATFORM_LABEL[p]}
      </Button>
    )
  })}
```

dengan `const PLATFORM_LABEL = { WHATSAPP: 'WhatsApp', INSTAGRAM: 'Instagram', FACEBOOK: 'Facebook', EMAIL: 'Email' } as const`.

Set state awal `useState<FilterOption | null>({ kind: 'platform', value: 'WHATSAPP' })` — **default WhatsApp**, supaya hari pertama setelah deploy tim melihat persis apa yang mereka lihat sekarang.

- [ ] **Step 3: Dukung filter di API**

Di `src/app/api/conversations/route.ts`, tambahkan ke klausa `where`:

```ts
  const platform = searchParams.get('platform')
  // ... di dalam objek where:
  ...(platform ? { channelIdentity: { platform: platform as Platform } } : {}),
```

- [ ] **Step 4: Verifikasi build klien**

```bash
npm run build
```

Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
npm test && npx tsc --noEmit && npx eslint .
git add src/components/inbox/ConversationList.tsx src/app/api/conversations/route.ts
git commit -m "feat(inbox): tab platform dengan WhatsApp sebagai default"
```

---

## Task 7: Uji ujung-ke-ujung dan deploy

- [ ] **Step 1: Build lokal**

```bash
npm test && npx tsc --noEmit && npx eslint . && npm run build
```

Expected: semua exit 0. **Jangan deploy kalau salah satu merah.**

- [ ] **Step 2: Deploy**

Push ke `origin/main`, lalu di VPS: `git checkout`, export PATH nvm Node 22, `npx prisma migrate deploy`, restart.

- [ ] **Step 3: Smoke test**

```bash
curl -sI https://<domain produksi> | head -1
```

Expected: `HTTP/2 200`.

- [ ] **Step 4: Uji pesan sungguhan — HANYA dari akun Facebook milik tim**

Kirim DM ke Page JVTO dari akun Facebook anggota tim. **Jangan pernah menguji ke akun pelanggan sungguhan.**

Verifikasi berurutan:
1. Percakapan muncul di tab **Facebook**, tidak muncul di tab WhatsApp.
2. Bot **tidak** menjawab (sakelar `botEnabledFacebook` default `false`).
3. Balas manual dari wa-inbox → pesan sampai di Messenger.
4. Kirim pesan kedua dari akun yang sama → masuk ke **percakapan yang sama**, bukan percakapan baru. Ini yang membuktikan `@@unique([channelIdentityId, externalThreadId])` bekerja.
5. Nyalakan sakelar Facebook di `/chatbot` → balas lagi → bot menjawab.

- [ ] **Step 5: Verifikasi tidak ada regresi WhatsApp**

Kirim satu pesan WhatsApp dari nomor whitelist `6282143403501`. Pastikan masuk ke tab WhatsApp dan bot menjawab seperti biasa.

---

## Selesai

Facebook Messenger jalan. Yang dibangun di sini — parser `entry[].messaging[]`, percabangan `payload.object`, dan `ingestMessengerPayload(payload, platform)` — **sudah menerima Instagram sebagai parameter**. Plan Instagram berikutnya sebagian besar soal kredensial dan pengiriman, bukan soal parsing ulang.

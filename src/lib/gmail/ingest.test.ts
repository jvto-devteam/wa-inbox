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
  // Fix round 1 (Temuan 1): baris kita bisa salah tercatat FAILED/PENDING kalau jawaban
  // messages.send hilang (5xx setelah Gmail menerima, koneksi putus, timeout fetch) atau
  // proses mati di antara pembuatan baris PENDING dan update akhirnya (restart pm2 saat
  // deploy). Salinan SENT yang tersinkron balik adalah bukti definitif email itu TERKIRIM --
  // tanpa perbaikan ini baris tetap FAILED/PENDING selamanya, operator menekan retry, dan
  // pelanggan menerima email yang sama dua kali.
  it('baris kita FAILED tanpa externalId direkonsiliasi jadi SENT dan broadcast message.updated', async () => {
    mockPrisma.message.findUnique
      .mockResolvedValueOnce(null as never) // cek externalId
      .mockResolvedValueOnce({ id: 'msg_kita', externalId: null, deliveryStatus: 'FAILED', conversationId: 'conv_kita' } as never) // cek X-WA-Inbox-Id
    mockPrisma.message.update.mockResolvedValue({ id: 'msg_kita', conversationId: 'conv_kita', externalId: 'gm_1', deliveryStatus: 'SENT' } as never)
    const sent = email({ labelIds: ['SENT'], from: 'hello@javavolcano-touroperator.com', headers: [{ name: 'X-WA-Inbox-Id', value: 'msg_kita' }] })

    expect(await ingestGmailMessage(account, sent)).toBe('reconciled')
    expect(mockPrisma.message.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'msg_kita' }, data: { externalId: 'gm_1', deliveryStatus: 'SENT' },
    }))
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ type: 'message.updated', conversationId: 'conv_kita' }))
    expect(mockPrisma.message.create).not.toHaveBeenCalled()
  })

  it('baris kita PENDING dengan externalId sudah terisi tetap direkonsiliasi jadi SENT', async () => {
    mockPrisma.message.findUnique
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce({ id: 'msg_kita', externalId: 'gm_1', deliveryStatus: 'PENDING', conversationId: 'conv_kita' } as never)
    mockPrisma.message.update.mockResolvedValue({ id: 'msg_kita', conversationId: 'conv_kita', externalId: 'gm_1', deliveryStatus: 'SENT' } as never)
    const sent = email({ labelIds: ['SENT'], from: 'hello@javavolcano-touroperator.com', headers: [{ name: 'X-WA-Inbox-Id', value: 'msg_kita' }] })

    expect(await ingestGmailMessage(account, sent)).toBe('reconciled')
    expect(mockPrisma.message.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'msg_kita' }, data: { externalId: 'gm_1', deliveryStatus: 'SENT' },
    }))
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ type: 'message.updated', conversationId: 'conv_kita' }))
  })

  it('baris kita sudah SENT dengan externalId terisi: tidak diupdate, tidak broadcast', async () => {
    mockPrisma.message.findUnique
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce({ id: 'msg_kita', externalId: 'gm_1', deliveryStatus: 'SENT', conversationId: 'conv_kita' } as never)
    const sent = email({ labelIds: ['SENT'], from: 'hello@javavolcano-touroperator.com', headers: [{ name: 'X-WA-Inbox-Id', value: 'msg_kita' }] })

    expect(await ingestGmailMessage(account, sent)).toBe('reconciled')
    expect(mockPrisma.message.update).not.toHaveBeenCalled()
    expect(broadcast).not.toHaveBeenCalled()
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

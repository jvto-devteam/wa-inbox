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

  it('Gmail menolak: baris jadi FAILED lewat updateMany berpenjaga externalId null, tidak melempar', async () => {
    // Fix round 1 (Temuan 1b): update akhir tidak boleh menimpa baris yang sudah SENT karena
    // ingest.ts (src/lib/gmail/ingest.ts) sempat merekonsiliasinya lebih dulu -- jawaban
    // messages.send yang gagal di sini bisa saja tetap sampai ke Gmail (5xx setelah diterima,
    // koneksi putus). Ditulis lewat updateMany berpenjaga `externalId: null`, lalu dibaca
    // ulang untuk nilai kembalian dan broadcast.
    vi.mocked(gmailSendRaw).mockRejectedValue(new Error('boom'))
    mockPrisma.message.updateMany.mockResolvedValue({ count: 1 } as never)
    mockPrisma.message.findUniqueOrThrow.mockResolvedValue({ id: 'msg_new', conversationId: 'conv_1', deliveryStatus: 'FAILED' } as never)

    await sendEmailMessage(params, undefined)

    expect(mockPrisma.message.updateMany).toHaveBeenCalledWith({
      where: { id: 'msg_new', externalId: null }, data: { deliveryStatus: 'FAILED' },
    })
    expect(mockPrisma.message.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: { deliveryStatus: 'FAILED' } }))
    expect(mockPrisma.message.findUniqueOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'msg_new' }, include: { replyTo: true } }),
    )
    expect(vi.mocked(broadcast).mock.calls.at(-1)?.[0]).toMatchObject({ type: 'message.updated', conversationId: 'conv_1' })
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

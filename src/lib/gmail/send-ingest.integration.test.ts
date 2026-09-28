import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { getAccessToken, gmailGetMessageHeaders, gmailSendRaw } from './client'
import type { GmailHeader, GmailMessage } from './types'

/**
 * Temuan review 8: setiap test lain di sekitar send.ts/ingest.ts memutuskan sambungannya --
 * send.test.ts mem-mock gmailSendRaw, ingest.test.ts mem-mock parseGmailMessage secara tidak
 * langsung lewat GmailMessage buatan tangan. Tidak satu pun membuktikan bahwa MIME MENTAH yang
 * benar-benar dikirim sendEmailMessage, kalau dibaca ulang sebagai balasan Gmail API (seperti
 * yang dilakukan sync.ts), bisa dikenali ingestGmailMessage lewat header X-WA-Inbox-Id-nya.
 *
 * Hanya batas HTTP Gmail (./client) dan Prisma/realtime yang di-mock di sini. send.ts, ingest.ts,
 * parse.ts, mime.ts, dan clean-body.ts semuanya ASLI -- kontraknya diuji ujung ke ujung.
 */
vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/realtime', () => ({ broadcast: vi.fn() }))
vi.mock('./client', () => ({ getAccessToken: vi.fn(), gmailGetMessageHeaders: vi.fn(), gmailSendRaw: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>
import { sendEmailMessage } from './send'
import { ingestGmailMessage } from './ingest'

const account = { id: 'mail_1', emailAddress: 'hello@javavolcano-touroperator.com' }
const conversation = {
  externalThreadId: 'th_1',
  subject: 'Tur Bromo',
  channelIdentity: { externalId: 'sinta@example.com' },
  mailAccount: { id: account.id, emailAddress: account.emailAddress, refreshToken: 'rt' },
}

/**
 * Membalik `buildReplyMime` (mime.ts): base64url -> teks RFC 822 -> { headers, body mentah }.
 * Ini meniru apa yang Gmail API BENAR-BENAR kembalikan lewat messages.get(format=full) --
 * `payload.body.data` sudah berisi base64url dari KONTEN TERDEKODE, bukan lagi Content-Transfer-
 * Encoding aslinya. Test ini sengaja tidak memakai anchor (findFirst -> null) supaya header tidak
 * mengandung References/In-Reply-To yang dilipat (fold) -- itu jalur mime.test.ts sendiri.
 */
function mimeRawToGmailMessage(raw: string, gmailId: string, threadId: string): GmailMessage {
  const full = Buffer.from(raw, 'base64url').toString('utf8')
  const boundary = full.indexOf('\r\n\r\n')
  const headerBlock = full.slice(0, boundary)
  const bodyEncoded = full.slice(boundary + 4)

  const headers: GmailHeader[] = headerBlock.split('\r\n').map((line) => {
    const idx = line.indexOf(': ')
    return { name: line.slice(0, idx), value: line.slice(idx + 2) }
  })
  // Content-Transfer-Encoding: base64 (mime.ts) dibongkar di sini supaya body.data yang dipasang
  // di bawah adalah teks polos terdekode -- persis kontrak Gmail API, bukan encoding transpornya.
  const plainText = Buffer.from(bodyEncoded.replace(/\r\n/g, ''), 'base64').toString('utf8')

  return {
    id: gmailId,
    threadId,
    labelIds: ['SENT'],
    internalDate: String(Date.now()),
    payload: {
      mimeType: 'text/plain',
      headers,
      body: { data: Buffer.from(plainText, 'utf8').toString('base64url') },
    },
  }
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.mocked(getAccessToken).mockReset().mockResolvedValue('at')
  vi.mocked(gmailGetMessageHeaders).mockReset().mockResolvedValue({})
  vi.mocked(gmailSendRaw).mockReset()
  mockPrisma.conversation.findUniqueOrThrow.mockResolvedValue(conversation as never)
  mockPrisma.message.findFirst.mockResolvedValue(null as never) // tanpa pesan jangkar -- lihat komentar di atas
})

describe('kirim -> sinkron: kontrak X-WA-Inbox-Id ujung ke ujung, tanpa mock di antara keduanya', () => {
  it('MIME mentah yang dikirim sendEmailMessage, dibaca ulang sebagai balasan Gmail, direkonsiliasi ingestGmailMessage', async () => {
    let capturedRaw = ''
    vi.mocked(gmailSendRaw).mockImplementation(async (_token, raw) => {
      capturedRaw = raw
      return { id: 'gm_sent_1', threadId: 'th_1' }
    })
    mockPrisma.message.create.mockResolvedValue({ id: 'msg_new', conversationId: 'conv_1' } as never)
    mockPrisma.message.update.mockResolvedValue({ id: 'msg_new', conversationId: 'conv_1', deliveryStatus: 'SENT', externalId: 'gm_sent_1' } as never)

    await sendEmailMessage({ conversationId: 'conv_1', text: 'Slot masih ada untuk 12 Okt.', sentBy: 'AGENT', agentId: 'acc_1' }, undefined)

    expect(capturedRaw).not.toBe('')
    const synced = mimeRawToGmailMessage(capturedRaw, 'gm_sent_1', 'th_1')

    // Kontrak header itu sendiri, sebelum ingestGmailMessage ikut campur: X-WA-Inbox-Id di MIME
    // yang benar-benar dikirim HARUS sama dengan id baris PENDING yang baru saja dibuat send.ts.
    const waInboxIdHeader = synced.payload?.headers?.find((h) => h.name === 'X-WA-Inbox-Id')?.value
    expect(waInboxIdHeader).toBe('msg_new')

    // Simulasikan baris PENDING itu MASIH PENDING saat sinkronisasi tiba (skenario yang
    // membuat perbaikan Fix round 1 / Temuan 1a di ingest.ts dibutuhkan): jawaban messages.send
    // yang mula-mula hilang, dan salinan SENT yang tersinkron balik ini satu-satunya bukti
    // emailnya benar-benar terkirim.
    mockPrisma.message.findUnique
      .mockResolvedValueOnce(null as never) // cek externalId: belum pernah tercatat
      .mockResolvedValueOnce({ id: 'msg_new', externalId: null, deliveryStatus: 'PENDING', conversationId: 'conv_1' } as never)

    const outcome = await ingestGmailMessage(account, synced)

    expect(outcome).toBe('reconciled')
    expect(mockPrisma.message.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'msg_new' },
      data: { externalId: 'gm_sent_1', deliveryStatus: 'SENT' },
    }))
  })
})

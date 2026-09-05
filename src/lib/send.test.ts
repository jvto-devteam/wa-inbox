import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { unlink } from 'fs/promises'
import path from 'path'
import { prisma } from '@/lib/db'
import { sendMessage } from './send'
import { sendMetaText, sendMetaMedia } from '@/lib/meta/messages'
import { uploadMetaMediaFromUrl } from '@/lib/meta/media-upload'
import { sendCoexistText, sendCoexistMedia } from '@/lib/coexist/client'
import { resolveChannel } from '@/lib/channel-router'
import { enqueueOutboundJob } from '@/lib/outbound/queue'
import { processOutboundJob } from '@/lib/outbound/worker'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/meta/messages', () => ({ sendMetaText: vi.fn(), sendMetaMedia: vi.fn() }))
vi.mock('@/lib/meta/media-upload', () => ({ uploadMetaMediaFromUrl: vi.fn() }))
vi.mock('@/lib/channel-router', () => ({ resolveChannel: vi.fn() }))
vi.mock('@/lib/coexist/client', () => ({ sendCoexistText: vi.fn(), sendCoexistMedia: vi.fn() }))
// Phase 6: Unofficial sends now go through the outbound queue. The queue and worker have their
// own suites (src/lib/outbound/*.test.ts); mocked here so these tests stay about what
// sendMessage itself decides -- which channel, what row, what payload -- exactly as the Meta
// and wa-coexist clients have always been mocked.
vi.mock('@/lib/outbound/queue', () => ({ enqueueOutboundJob: vi.fn() }))
vi.mock('@/lib/outbound/worker', () => ({ processOutboundJob: vi.fn() }))
vi.mock('fs/promises', () => {
  const unlink = vi.fn()
  return { unlink, default: { unlink } }
})
const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

beforeEach(() => {
  mockReset(mockPrisma)
  // resolveChannel/sendMetaText/sendCoexistText are plain vi.fn() module mocks, not reset by
  // mockReset(mockPrisma) above -- without this, a mockResolvedValue('UNOFFICIAL') set by one
  // test (or a stale call history) leaks into every test that runs after it in this file.
  vi.mocked(resolveChannel).mockReset().mockResolvedValue('OFFICIAL')
  vi.mocked(sendMetaText).mockReset()
  vi.mocked(sendMetaMedia).mockReset()
  vi.mocked(uploadMetaMediaFromUrl).mockReset()
  vi.mocked(sendCoexistText).mockReset()
  vi.mocked(sendCoexistMedia).mockReset()
  vi.mocked(unlink).mockReset().mockResolvedValue(undefined)
  vi.mocked(enqueueOutboundJob).mockReset().mockResolvedValue({ jobId: 'job_1', blocked: false, warnings: [] })
  vi.mocked(processOutboundJob).mockReset().mockResolvedValue('sent')
  mockPrisma.conversation.findUniqueOrThrow.mockResolvedValue({
    id: 'conv_1', contactId: 'contact_1', contact: { phone: '6281234567890' },
  } as never)
  mockPrisma.waNumber.findFirstOrThrow.mockResolvedValue({
    phoneNumberId: 'pnid', accessToken: 'tok',
  } as never)
})

describe('sendMessage', () => {
  it('sends via Official Graph API by default and records a SENT message', async () => {
    vi.mocked(sendMetaText).mockResolvedValue({ externalId: 'wamid.OUT1' })
    mockPrisma.message.create.mockResolvedValue({ id: 'msg_1', deliveryStatus: 'SENT' } as never)

    const result = await sendMessage({ conversationId: 'conv_1', text: 'Halo!', sentBy: 'AGENT', agentId: 'acc_1' })

    expect(result.deliveryStatus).toBe('SENT')
    expect(mockPrisma.message.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ channel: 'OFFICIAL', direction: 'OUTBOUND', sentBy: 'AGENT', externalId: 'wamid.OUT1' }),
    }))
  })

  it('records a FAILED message when the send throws, without throwing itself, and logs the error', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const sendError = new Error('rate limited')
    vi.mocked(sendMetaText).mockRejectedValue(sendError)
    mockPrisma.message.create.mockResolvedValue({ id: 'msg_2', deliveryStatus: 'FAILED' } as never)

    const result = await sendMessage({ conversationId: 'conv_1', text: 'Halo!', sentBy: 'BOT' })

    expect(result.deliveryStatus).toBe('FAILED')
    expect(mockPrisma.message.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ deliveryStatus: 'FAILED' }),
    }))
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('sendMessage'),
      expect.objectContaining({ conversationId: 'conv_1', error: sendError })
    )

    consoleErrorSpy.mockRestore()
  })

  it('queues an Unofficial send instead of firing at wa-coexist inline', async () => {
    // Phase 6 behaviour change: the message row is stored FIRST, as PENDING, so a provider
    // outage can no longer destroy it. The provider call itself moved to the worker.
    vi.mocked(resolveChannel).mockResolvedValue('UNOFFICIAL')
    mockPrisma.message.create.mockResolvedValue({ id: 'msg_3', deliveryStatus: 'PENDING' } as never)

    const result = await sendMessage({ conversationId: 'conv_1', text: 'Halo!', sentBy: 'AGENT' })

    expect(result.deliveryStatus).toBe('PENDING')
    expect(sendCoexistText).not.toHaveBeenCalled()
    expect(mockPrisma.message.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ channel: 'UNOFFICIAL', deliveryStatus: 'PENDING' }),
    }))
    expect(enqueueOutboundJob).toHaveBeenCalledWith(expect.objectContaining({
      messageId: 'msg_3',
      channel: 'UNOFFICIAL',
      provider: 'COEXIST',
      contactId: 'contact_1',
      payload: expect.objectContaining({ to: '6281234567890', text: 'Halo!' }),
    }))
  })

  it('fires the first attempt immediately, so a healthy queued send is no slower than before', async () => {
    vi.mocked(resolveChannel).mockResolvedValue('UNOFFICIAL')
    mockPrisma.message.create.mockResolvedValue({ id: 'msg_3b', deliveryStatus: 'PENDING' } as never)

    await sendMessage({ conversationId: 'conv_1', text: 'Halo!', sentBy: 'AGENT' })

    expect(processOutboundJob).toHaveBeenCalledWith('job_1')
  })

  it('marks the message FAILED when the safety guard blocks the send', async () => {
    // Left PENDING it would be a message that silently never arrives; the reason lives on the
    // cancelled job row and the bubble shows FAILED with a retry button.
    vi.mocked(resolveChannel).mockResolvedValue('UNOFFICIAL')
    vi.mocked(enqueueOutboundJob).mockResolvedValue({
      jobId: 'job_blocked', blocked: true, blockingReason: 'Kontak opt-out', warnings: [],
    })
    mockPrisma.message.create.mockResolvedValue({ id: 'msg_blocked', deliveryStatus: 'PENDING' } as never)
    mockPrisma.message.update.mockResolvedValue({ id: 'msg_blocked', deliveryStatus: 'FAILED' } as never)

    const result = await sendMessage({ conversationId: 'conv_1', text: 'Promo!', sentBy: 'AGENT' })

    expect(result.deliveryStatus).toBe('FAILED')
    expect(processOutboundJob).not.toHaveBeenCalled()
  })

  it('passes the quoted parent\'s wamid as Meta context on an Official reply', async () => {
    mockPrisma.message.findUnique.mockResolvedValue({ id: 'msg_parent', externalId: 'wamid.PARENT' } as never)
    vi.mocked(sendMetaText).mockResolvedValue({ externalId: 'wamid.OUT2' })
    mockPrisma.message.create.mockResolvedValue({ id: 'msg_4', deliveryStatus: 'SENT' } as never)

    await sendMessage({ conversationId: 'conv_1', text: 'Baik, siap!', sentBy: 'AGENT', replyToId: 'msg_parent' })

    expect(mockPrisma.message.findUnique).toHaveBeenCalledWith({ where: { id: 'msg_parent' } })
    expect(sendMetaText).toHaveBeenCalledWith(
      expect.objectContaining({ phoneNumberId: 'pnid' }),
      '6281234567890',
      'Baik, siap!',
      'wamid.PARENT'
    )
    expect(mockPrisma.message.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ replyToId: 'msg_parent' }),
      include: { replyTo: true },
    }))
  })

  it('stores replyToId locally but never puts a reply context in the queued payload', async () => {
    // wa-coexist's send API has no context/reply parameter, so the quote is a local-only
    // concept. The queued payload must not carry one either, or a worker would try to use it.
    vi.mocked(resolveChannel).mockResolvedValue('UNOFFICIAL')
    mockPrisma.message.findUnique.mockResolvedValue({ id: 'msg_parent', externalId: 'wamid.PARENT' } as never)
    mockPrisma.message.create.mockResolvedValue({ id: 'msg_5', deliveryStatus: 'PENDING' } as never)

    await sendMessage({ conversationId: 'conv_1', text: 'Oke', sentBy: 'AGENT', replyToId: 'msg_parent' })

    expect(mockPrisma.message.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ replyToId: 'msg_parent' }),
    }))
    const payload = vi.mocked(enqueueOutboundJob).mock.calls[0][0].payload
    expect(payload).toEqual({ to: '6281234567890', text: 'Oke', media: undefined })
  })

  it('sends with no context when the quoted parent has no externalId (e.g. a log-only handoff row)', async () => {
    mockPrisma.message.findUnique.mockResolvedValue({ id: 'msg_parent', externalId: null } as never)
    vi.mocked(sendMetaText).mockResolvedValue({ externalId: 'wamid.OUT3' })
    mockPrisma.message.create.mockResolvedValue({ id: 'msg_6', deliveryStatus: 'SENT' } as never)

    await sendMessage({ conversationId: 'conv_1', text: 'Halo', sentBy: 'AGENT', replyToId: 'msg_parent' })

    expect(sendMetaText).toHaveBeenCalledWith(expect.anything(), '6281234567890', 'Halo', undefined)
  })

  it('skips the real dispatch entirely for the sandbox (isTest) conversation and still records the message as SENT', async () => {
    mockPrisma.conversation.findUniqueOrThrow.mockResolvedValue({
      id: 'conv_test', isTest: true, contact: { phone: '__bot_test__' },
    } as never)
    mockPrisma.message.create.mockResolvedValue({ id: 'msg_test', deliveryStatus: 'SENT' } as never)

    const result = await sendMessage({ conversationId: 'conv_test', text: 'Anda tertarik jalan-jalan ke mana?', sentBy: 'BOT' })

    expect(result.deliveryStatus).toBe('SENT')
    expect(sendMetaText).not.toHaveBeenCalled()
    expect(sendCoexistText).not.toHaveBeenCalled()
    expect(mockPrisma.waNumber.findFirstOrThrow).not.toHaveBeenCalled()
    expect(mockPrisma.message.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ externalId: undefined, deliveryStatus: 'SENT', sentBy: 'BOT' }),
    }))
  })
})

describe('sendMessage — media attachments', () => {
  const media = { url: 'https://wa-inbox.example.com/uploads/x.jpg', type: 'image' as const, mimeType: 'image/jpeg', fileName: 'x.jpg' }

  it('uploads to Meta and sends via sendMetaMedia on the Official channel, storing the returned media id', async () => {
    vi.mocked(uploadMetaMediaFromUrl).mockResolvedValue({ id: 'meta_media_1', mimeType: 'image/jpeg' })
    vi.mocked(sendMetaMedia).mockResolvedValue({ externalId: 'wamid.M1' })
    mockPrisma.message.create.mockResolvedValue({ id: 'msg_m1', deliveryStatus: 'SENT' } as never)

    await sendMessage({ conversationId: 'conv_1', text: 'Lihat ini', sentBy: 'AGENT', media })

    expect(uploadMetaMediaFromUrl).toHaveBeenCalledWith(expect.objectContaining({ phoneNumberId: 'pnid' }), media.url)
    expect(sendMetaMedia).toHaveBeenCalledWith(
      expect.objectContaining({ phoneNumberId: 'pnid' }),
      '6281234567890',
      'image',
      'meta_media_1',
      'Lihat ini',
      undefined
    )
    expect(mockPrisma.message.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: 'image', mediaId: 'meta_media_1', mediaUrl: null, mimeType: 'image/jpeg', fileName: 'x.jpg' }),
    }))
  })

  it('deletes the local upload after a successful Official send, since Meta now holds a durable copy', async () => {
    vi.mocked(uploadMetaMediaFromUrl).mockResolvedValue({ id: 'meta_media_1', mimeType: 'image/jpeg' })
    vi.mocked(sendMetaMedia).mockResolvedValue({ externalId: 'wamid.M1' })
    mockPrisma.message.create.mockResolvedValue({ id: 'msg_m1', deliveryStatus: 'SENT' } as never)

    await sendMessage({ conversationId: 'conv_1', text: 'Lihat ini', sentBy: 'AGENT', media })

    expect(unlink).toHaveBeenCalledWith(expect.stringContaining(path.join('public', 'uploads', 'x.jpg')))
  })

  it('still deletes the local upload even when the follow-up sendMetaMedia call itself fails (Meta already has the media)', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(uploadMetaMediaFromUrl).mockResolvedValue({ id: 'meta_media_1', mimeType: 'image/jpeg' })
    vi.mocked(sendMetaMedia).mockRejectedValue(new Error('rate limited'))
    mockPrisma.message.create.mockResolvedValue({ id: 'msg_m1b', deliveryStatus: 'FAILED' } as never)

    await sendMessage({ conversationId: 'conv_1', text: 'Lihat ini', sentBy: 'AGENT', media })

    expect(unlink).toHaveBeenCalled()
    consoleErrorSpy.mockRestore()
  })

  it('does not fail the send when deleting the local upload itself throws', async () => {
    vi.mocked(uploadMetaMediaFromUrl).mockResolvedValue({ id: 'meta_media_1', mimeType: 'image/jpeg' })
    vi.mocked(sendMetaMedia).mockResolvedValue({ externalId: 'wamid.M1' })
    vi.mocked(unlink).mockRejectedValue(new Error('ENOENT'))
    mockPrisma.message.create.mockResolvedValue({ id: 'msg_m1c', deliveryStatus: 'SENT' } as never)
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const result = await sendMessage({ conversationId: 'conv_1', text: 'Lihat ini', sentBy: 'AGENT', media })

    expect(result.deliveryStatus).toBe('SENT')
    consoleWarnSpy.mockRestore()
  })

  it('queues an Unofficial media send with the raw upload URL, and never deletes the local upload', async () => {
    vi.mocked(resolveChannel).mockResolvedValue('UNOFFICIAL')
    mockPrisma.message.create.mockResolvedValue({ id: 'msg_m2', deliveryStatus: 'PENDING' } as never)

    await sendMessage({ conversationId: 'conv_1', text: '', sentBy: 'AGENT', media })

    expect(uploadMetaMediaFromUrl).not.toHaveBeenCalled()
    expect(mockPrisma.message.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: 'image', mediaUrl: media.url }),
    }))
    expect(vi.mocked(enqueueOutboundJob).mock.calls[0][0].payload.media).toEqual(media)
    // No Meta media id exists to fall back on, so the local upload is the ONLY surviving copy
    // of this file -- deleting it would make the media unrenderable forever after. It matters
    // even more now: a retry ten minutes later still has to be able to fetch that URL.
    expect(unlink).not.toHaveBeenCalled()
  })

  it('keeps Message.type as audio and passes the audio type through to the queue', async () => {
    // The audio -> document mapping wa-coexist needs now happens in the worker's dispatch (see
    // outbound/worker.test.ts); the payload must carry the TRUE type so the worker can decide.
    vi.mocked(resolveChannel).mockResolvedValue('UNOFFICIAL')
    mockPrisma.message.create.mockResolvedValue({ id: 'msg_m3', deliveryStatus: 'PENDING' } as never)

    await sendMessage({
      conversationId: 'conv_1', text: '', sentBy: 'AGENT',
      media: { url: 'https://wa-inbox.example.com/uploads/x.ogg', type: 'audio', mimeType: 'audio/ogg', fileName: 'x.ogg' },
    })

    expect(mockPrisma.message.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ type: 'audio' }) }))
    expect(vi.mocked(enqueueOutboundJob).mock.calls[0][0].payload.media?.type).toBe('audio')
  })

  it('records a FAILED message when the Meta media upload itself throws', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(uploadMetaMediaFromUrl).mockRejectedValue(new Error('download failed'))
    mockPrisma.message.create.mockResolvedValue({ id: 'msg_m4', deliveryStatus: 'FAILED' } as never)

    const result = await sendMessage({ conversationId: 'conv_1', text: '', sentBy: 'AGENT', media })

    expect(result.deliveryStatus).toBe('FAILED')
    expect(sendMetaMedia).not.toHaveBeenCalled()
    consoleErrorSpy.mockRestore()
  })
})

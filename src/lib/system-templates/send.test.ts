/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { enqueueOutboundJob } from '@/lib/outbound/queue'
import { processOutboundJob } from '@/lib/outbound/worker'
import { broadcast } from '@/lib/realtime'
import { enqueueSystemTemplateSend } from './send'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/outbound/queue', () => ({ enqueueOutboundJob: vi.fn() }))
vi.mock('@/lib/outbound/worker', () => ({ processOutboundJob: vi.fn() }))
vi.mock('@/lib/realtime', () => ({ broadcast: vi.fn() }))
vi.mock('@/lib/inbound', () => ({ defaultBotEnabled: vi.fn().mockResolvedValue(true) }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

function template(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tpl_1',
    key: 'payment_received_first',
    name: 'Payment received',
    description: null,
    audience: 'CUSTOMER',
    body: 'Hi {name}, booking {booking_code} confirmed.',
    imageUrl: null,
    variables: [
      { name: 'name', required: true },
      { name: 'booking_code', required: true },
    ],
    isActive: true,
    updatedById: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as never
}

const base = {
  clientId: 'client_1',
  templateKey: 'payment_received_first',
  to: { phone: '+62 812-3456-7890' },
  variables: { name: 'Anna', booking_code: 'JVTO-1' },
  idempotencyKey: 'payment_received_first:1',
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.clearAllMocks()
  mockPrisma.outboundJob.findUnique.mockResolvedValue(null)
  mockPrisma.systemTemplate.findUnique.mockResolvedValue(template())
  mockPrisma.channelIdentity.findUnique.mockResolvedValue(null)
  mockPrisma.contact.create.mockResolvedValue({ id: 'contact_1' } as never)
  mockPrisma.channelIdentity.upsert.mockResolvedValue({ id: 'identity_1', contactId: 'contact_1' } as never)
  mockPrisma.conversation.upsert.mockResolvedValue({ id: 'conv_1' } as never)
  mockPrisma.message.create.mockResolvedValue({ id: 'msg_1', conversationId: 'conv_1' } as never)
  vi.mocked(enqueueOutboundJob).mockResolvedValue({ jobId: 'job_1', blocked: false, warnings: [] })
  vi.mocked(processOutboundJob).mockResolvedValue('sent')
})

describe('enqueueSystemTemplateSend', () => {
  it('returns the existing job for a repeated idempotency key and sends nothing', async () => {
    mockPrisma.outboundJob.findUnique.mockResolvedValue({ id: 'job_old', status: 'SENT' } as never)

    expect(await enqueueSystemTemplateSend(base)).toEqual({ ok: true, jobId: 'job_old', status: 'SENT', duplicate: true })
    expect(enqueueOutboundJob).not.toHaveBeenCalled()
    expect(mockPrisma.message.create).not.toHaveBeenCalled()
  })

  it('refuses an unknown or switched-off template', async () => {
    mockPrisma.systemTemplate.findUnique.mockResolvedValue(null)
    expect(await enqueueSystemTemplateSend(base)).toEqual({ ok: false, code: 'TEMPLATE_NOT_FOUND' })

    mockPrisma.systemTemplate.findUnique.mockResolvedValue(template({ isActive: false }))
    expect(await enqueueSystemTemplateSend(base)).toEqual({ ok: false, code: 'TEMPLATE_NOT_FOUND' })
  })

  it('refuses to send with a required variable missing, naming it', async () => {
    const result = await enqueueSystemTemplateSend({ ...base, variables: { name: 'Anna' } })
    expect(result).toEqual({ ok: false, code: 'MISSING_VARIABLES', missing: ['booking_code'] })
    expect(enqueueOutboundJob).not.toHaveBeenCalled()
  })

  it('puts a CUSTOMER send into the customer conversation as a PENDING bubble, then queues it', async () => {
    const result = await enqueueSystemTemplateSend(base)

    expect(result).toEqual({ ok: true, jobId: 'job_1', status: 'QUEUED', duplicate: false })
    expect(mockPrisma.contact.create).toHaveBeenCalledWith({ data: { phone: '6281234567890', name: 'Anna' } })
    expect(mockPrisma.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          conversationId: 'conv_1',
          content: 'Hi Anna, booking JVTO-1 confirmed.',
          channel: 'UNOFFICIAL',
          deliveryStatus: 'PENDING',
        }),
      })
    )
    expect(enqueueOutboundJob).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv_1',
        messageId: 'msg_1',
        contactId: 'contact_1',
        purpose: 'SYSTEM',
        idempotencyKey: 'payment_received_first:1',
        templateKey: 'payment_received_first',
        sourceClientId: 'client_1',
        payload: { to: '6281234567890', text: 'Hi Anna, booking JVTO-1 confirmed.', media: undefined, targetType: 'PHONE' },
      })
    )
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ type: 'message.created', conversationId: 'conv_1' }))
    expect(processOutboundJob).toHaveBeenCalledWith('job_1')
  })

  it('sends a template with an image as image + caption', async () => {
    mockPrisma.systemTemplate.findUnique.mockResolvedValue(template({ imageUrl: 'https://x.test/booking-confirmed.jpg' }))
    await enqueueSystemTemplateSend(base)

    expect(enqueueOutboundJob).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          media: { url: 'https://x.test/booking-confirmed.jpg', type: 'image', mimeType: 'image/jpeg' },
        }),
      })
    )
  })

  it('lets the caller override the template image for one send (pickup sign)', async () => {
    mockPrisma.systemTemplate.findUnique.mockResolvedValue(template({ imageUrl: 'https://x.test/trip-reminder.jpg' }))
    await enqueueSystemTemplateSend({ ...base, imageUrl: 'https://legacy.javavolcano-touroperator.com/pickup-sign/img/Ab3dE5fG7h.png' })

    expect(enqueueOutboundJob).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          media: {
            url: 'https://legacy.javavolcano-touroperator.com/pickup-sign/img/Ab3dE5fG7h.png',
            type: 'image',
            mimeType: 'image/png',
          },
        }),
      })
    )
  })

  it('still sends an image when only the caller supplies one', async () => {
    mockPrisma.systemTemplate.findUnique.mockResolvedValue(template({ imageUrl: null }))
    await enqueueSystemTemplateSend({ ...base, imageUrl: 'https://jvto.me/x.png' })

    expect(enqueueOutboundJob).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ media: expect.objectContaining({ url: 'https://jvto.me/x.png' }) }) })
    )
  })

  it('never creates a conversation for an INTERNAL template', async () => {
    mockPrisma.systemTemplate.findUnique.mockResolvedValue(
      template({ audience: 'INTERNAL', body: '{name} has completed the consent form', variables: [{ name: 'name', required: true }] })
    )
    await enqueueSystemTemplateSend({ ...base, to: { phone: '082143403501' }, variables: { name: 'Anna' } })

    expect(mockPrisma.contact.create).not.toHaveBeenCalled()
    expect(mockPrisma.message.create).not.toHaveBeenCalled()
    expect(enqueueOutboundJob).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: null,
        messageId: null,
        contactId: null,
        target: '6282143403501',
        payload: expect.objectContaining({ to: '6282143403501', targetType: 'PHONE' }),
      })
    )
  })

  it('sends to a group as a GROUP job, with no conversation, whatever the audience', async () => {
    await enqueueSystemTemplateSend({ ...base, to: { groupId: '120363335090996109@g.us' } })

    expect(mockPrisma.contact.create).not.toHaveBeenCalled()
    expect(enqueueOutboundJob).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: null,
        target: 'grup:120363335090996109@g.us',
        payload: expect.objectContaining({ to: '120363335090996109@g.us', targetType: 'GROUP' }),
      })
    )
  })

  it('survives losing the race to create a new customer contact', async () => {
    const { Prisma } = await import('@prisma/client')
    const conflict = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
    })
    mockPrisma.contact.create.mockRejectedValueOnce(conflict).mockResolvedValueOnce({ id: 'contact_1' } as never)

    expect(await enqueueSystemTemplateSend(base)).toEqual({ ok: true, jobId: 'job_1', status: 'QUEUED', duplicate: false })
    expect(mockPrisma.contact.create).toHaveBeenCalledTimes(2)
  })

  it('refuses a phone that is not a phone number', async () => {
    expect(await enqueueSystemTemplateSend({ ...base, to: { phone: 'abc' } })).toEqual({ ok: false, code: 'INVALID_PHONE' })
  })

  it('removes its own bubble when a parallel request with the same key won the race', async () => {
    vi.mocked(enqueueOutboundJob).mockResolvedValue({ jobId: 'job_winner', blocked: false, duplicate: true, warnings: [] })
    mockPrisma.message.delete.mockResolvedValue({} as never)

    const result = await enqueueSystemTemplateSend(base)

    expect(result).toEqual({ ok: true, jobId: 'job_winner', status: 'QUEUED', duplicate: true })
    expect(mockPrisma.message.delete).toHaveBeenCalledWith({ where: { id: 'msg_1' } })
    expect(processOutboundJob).not.toHaveBeenCalled()
  })

  it('reports a failure to queue instead of pretending it was sent', async () => {
    vi.mocked(enqueueOutboundJob).mockResolvedValue({ jobId: null, blocked: false, warnings: [] })
    mockPrisma.message.update.mockResolvedValue({ id: 'msg_1', conversationId: 'conv_1' } as never)

    expect(await enqueueSystemTemplateSend(base)).toEqual({ ok: false, code: 'ENQUEUE_FAILED' })
    expect(mockPrisma.message.update).toHaveBeenCalledWith(expect.objectContaining({ data: { deliveryStatus: 'FAILED' } }))
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { POST } from './route'
import { sendTemplateMessage } from '@/lib/meta/messages'
import { uploadMetaMediaFromUrl } from '@/lib/meta/media-upload'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/meta/messages', () => ({ sendTemplateMessage: vi.fn() }))
vi.mock('@/lib/meta/media-upload', () => ({ uploadMetaMediaFromUrl: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

beforeEach(() => {
  mockReset(mockPrisma)
  vi.mocked(sendTemplateMessage).mockReset()
  vi.mocked(uploadMetaMediaFromUrl).mockReset()
  mockPrisma.conversation.findUniqueOrThrow.mockResolvedValue({
    id: 'conv_1', contact: { phone: '6281234567890' },
  } as never)
  mockPrisma.waNumber.findFirstOrThrow.mockResolvedValue({ phoneNumberId: 'pnid', accessToken: 'tok' } as never)
})

function req(body: unknown) {
  return new Request('http://localhost/api/send/template', { method: 'POST', body: JSON.stringify(body) })
}

describe('POST /api/send/template', () => {
  it('returns 404 when the template does not exist', async () => {
    mockPrisma.template.findUnique.mockResolvedValue(null)
    const res = await POST(req({ conversationId: 'conv_1', templateId: 'missing' }))
    expect(res.status).toBe(404)
  })

  it('returns 400 when the template is not yet APPROVED', async () => {
    mockPrisma.template.findUnique.mockResolvedValue({ id: 't1', metaStatus: 'PENDING', body: 'Halo', cards: null } as never)
    const res = await POST(req({ conversationId: 'conv_1', templateId: 't1' }))
    expect(res.status).toBe(400)
    expect(sendTemplateMessage).not.toHaveBeenCalled()
  })

  it('sends a TEXT template, interpolates the body, and records the resolved templatePayload', async () => {
    mockPrisma.template.findUnique.mockResolvedValue({
      id: 't1', name: 'booking_confirmation', metaStatus: 'APPROVED', body: 'Halo {{1}}, paket Anda {{2}} sudah dikonfirmasi.', cards: null,
    } as never)
    vi.mocked(sendTemplateMessage).mockResolvedValue({ externalId: 'wamid.TPL1' })
    mockPrisma.message.create.mockResolvedValue({ id: 'msg_1', deliveryStatus: 'SENT' } as never)

    const res = await POST(req({ conversationId: 'conv_1', templateId: 't1', bodyParams: ['Bruno', 'Ijen 3D2N'] }))

    expect(res.status).toBe(200)
    expect(sendTemplateMessage).toHaveBeenCalledWith(
      { phoneNumberId: 'pnid', accessToken: 'tok' },
      '6281234567890',
      { name: 'booking_confirmation', bodyParams: ['Bruno', 'Ijen 3D2N'], cards: [] }
    )
    expect(mockPrisma.message.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        type: 'template',
        channel: 'OFFICIAL',
        content: 'Halo Bruno, paket Anda Ijen 3D2N sudah dikonfirmasi.',
        templatePayload: { templateName: 'booking_confirmation', bodyText: 'Halo Bruno, paket Anda Ijen 3D2N sudah dikonfirmasi.', cards: undefined },
      }),
    }))
  })

  it('uploads each card\'s media fresh and sends the resolved carousel', async () => {
    const card = { mediaType: 'IMAGE', mediaUrl: 'https://example.com/ijen.jpg', bodyText: 'Paket Ijen', buttons: [] }
    mockPrisma.template.findUnique.mockResolvedValue({
      id: 't2', name: 'katalog_paket', metaStatus: 'APPROVED', body: 'Halo, rekomendasi untuk Anda:', cards: [card],
    } as never)
    vi.mocked(uploadMetaMediaFromUrl).mockResolvedValue({ id: 'media_fresh_1', mimeType: 'image/jpeg' })
    vi.mocked(sendTemplateMessage).mockResolvedValue({ externalId: 'wamid.TPL2' })
    mockPrisma.message.create.mockResolvedValue({ id: 'msg_2', deliveryStatus: 'SENT' } as never)

    const res = await POST(req({ conversationId: 'conv_1', templateId: 't2' }))

    expect(res.status).toBe(200)
    expect(uploadMetaMediaFromUrl).toHaveBeenCalledWith({ phoneNumberId: 'pnid', accessToken: 'tok' }, 'https://example.com/ijen.jpg')
    expect(sendTemplateMessage).toHaveBeenCalledWith(
      expect.anything(),
      '6281234567890',
      expect.objectContaining({ cards: [{ mediaId: 'media_fresh_1', mediaType: 'IMAGE', buttons: [] }] })
    )
    expect(mockPrisma.message.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ templatePayload: expect.objectContaining({ cards: [card] }) }),
    }))
  })

  it('uploads a TEXT/AUTH template\'s media header fresh and sends it as a header parameter', async () => {
    mockPrisma.template.findUnique.mockResolvedValue({
      id: 't4', name: 'promo', metaStatus: 'APPROVED', body: 'Halo!', cards: null,
      header: { type: 'IMAGE', mediaUrl: 'https://example.com/banner.jpg' },
    } as never)
    vi.mocked(uploadMetaMediaFromUrl).mockResolvedValue({ id: 'media_header_1', mimeType: 'image/jpeg' })
    vi.mocked(sendTemplateMessage).mockResolvedValue({ externalId: 'wamid.TPL5' })
    mockPrisma.message.create.mockResolvedValue({ id: 'msg_4', deliveryStatus: 'SENT' } as never)

    const res = await POST(req({ conversationId: 'conv_1', templateId: 't4' }))

    expect(res.status).toBe(200)
    expect(uploadMetaMediaFromUrl).toHaveBeenCalledWith({ phoneNumberId: 'pnid', accessToken: 'tok' }, 'https://example.com/banner.jpg')
    expect(sendTemplateMessage).toHaveBeenCalledWith(
      expect.anything(),
      '6281234567890',
      expect.objectContaining({ header: { mediaId: 'media_header_1', mediaType: 'IMAGE' } })
    )
  })

  it('sends no header parameter for a plain TEXT header (static, no upload needed)', async () => {
    mockPrisma.template.findUnique.mockResolvedValue({
      id: 't5', name: 'sapaan', metaStatus: 'APPROVED', body: 'Halo!', cards: null,
      header: { type: 'TEXT', text: 'Selamat Datang' },
    } as never)
    vi.mocked(sendTemplateMessage).mockResolvedValue({ externalId: 'wamid.TPL6' })
    mockPrisma.message.create.mockResolvedValue({ id: 'msg_5', deliveryStatus: 'SENT' } as never)

    const res = await POST(req({ conversationId: 'conv_1', templateId: 't5' }))

    expect(res.status).toBe(200)
    expect(uploadMetaMediaFromUrl).not.toHaveBeenCalled()
    expect(sendTemplateMessage).toHaveBeenCalledWith(expect.anything(), '6281234567890', expect.objectContaining({ header: undefined }))
  })

  it('returns 502 without sending or creating a row when media upload fails', async () => {
    const card = { mediaType: 'IMAGE', mediaUrl: 'https://example.com/broken.jpg', bodyText: 'x', buttons: [] }
    mockPrisma.template.findUnique.mockResolvedValue({
      id: 't3', name: 'katalog_paket', metaStatus: 'APPROVED', body: 'Halo', cards: [card],
    } as never)
    vi.mocked(uploadMetaMediaFromUrl).mockRejectedValue(new Error('Gagal mengunduh media dari https://example.com/broken.jpg'))

    const res = await POST(req({ conversationId: 'conv_1', templateId: 't3' }))

    expect(res.status).toBe(502)
    expect(sendTemplateMessage).not.toHaveBeenCalled()
    expect(mockPrisma.message.create).not.toHaveBeenCalled()
  })

  it('sends an LTO template with the real per-send expiration and snapshots it onto templatePayload', async () => {
    mockPrisma.template.findUnique.mockResolvedValue({
      id: 't_lto', name: 'promo_akhir_tahun', metaStatus: 'APPROVED', format: 'LTO',
      body: 'Nikmati diskon spesial!', cards: null, offerTitle: 'Diskon 25%',
    } as never)
    vi.mocked(sendTemplateMessage).mockResolvedValue({ externalId: 'wamid.LTO1' })
    mockPrisma.message.create.mockResolvedValue({ id: 'msg_lto', deliveryStatus: 'SENT' } as never)

    const res = await POST(req({ conversationId: 'conv_1', templateId: 't_lto', expirationTimeMs: 1735680000000 }))

    expect(res.status).toBe(200)
    expect(sendTemplateMessage).toHaveBeenCalledWith(
      expect.anything(), '6281234567890',
      expect.objectContaining({ limitedTimeOfferExpirationMs: 1735680000000 })
    )
    expect(mockPrisma.message.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        templatePayload: expect.objectContaining({ limitedTimeOffer: { text: 'Diskon 25%', expirationTimeMs: 1735680000000 } }),
      }),
    }))
  })

  it('returns 400 for an LTO template send with no expiration given', async () => {
    mockPrisma.template.findUnique.mockResolvedValue({
      id: 't_lto', name: 'promo_akhir_tahun', metaStatus: 'APPROVED', format: 'LTO', body: 'Halo', cards: null, offerTitle: 'Promo',
    } as never)

    const res = await POST(req({ conversationId: 'conv_1', templateId: 't_lto' }))

    expect(res.status).toBe(400)
    expect(sendTemplateMessage).not.toHaveBeenCalled()
  })

  it('sends a COUPON template with the real per-send code and snapshots it onto templatePayload', async () => {
    mockPrisma.template.findUnique.mockResolvedValue({
      id: 't_coupon', name: 'kode_diskon', metaStatus: 'APPROVED', format: 'COUPON',
      body: 'Gunakan kode ini.', cards: null, couponButtonText: 'Salin Kode',
    } as never)
    vi.mocked(sendTemplateMessage).mockResolvedValue({ externalId: 'wamid.COUPON1' })
    mockPrisma.message.create.mockResolvedValue({ id: 'msg_coupon', deliveryStatus: 'SENT' } as never)

    const res = await POST(req({ conversationId: 'conv_1', templateId: 't_coupon', couponCode: 'PROMO25' }))

    expect(res.status).toBe(200)
    expect(sendTemplateMessage).toHaveBeenCalledWith(
      expect.anything(), '6281234567890',
      expect.objectContaining({ couponCode: 'PROMO25' })
    )
    expect(mockPrisma.message.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        templatePayload: expect.objectContaining({ coupon: { buttonText: 'Salin Kode', code: 'PROMO25' } }),
      }),
    }))
  })

  it('returns 400 for a COUPON template send with no code given', async () => {
    mockPrisma.template.findUnique.mockResolvedValue({
      id: 't_coupon', name: 'kode_diskon', metaStatus: 'APPROVED', format: 'COUPON', body: 'Halo', cards: null, couponButtonText: 'Salin Kode',
    } as never)

    const res = await POST(req({ conversationId: 'conv_1', templateId: 't_coupon' }))

    expect(res.status).toBe(400)
    expect(sendTemplateMessage).not.toHaveBeenCalled()
  })

  it('records a FAILED message when the Cloud API dispatch itself fails, without throwing', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockPrisma.template.findUnique.mockResolvedValue({
      id: 't1', name: 'booking_confirmation', metaStatus: 'APPROVED', body: 'Halo', cards: null,
    } as never)
    vi.mocked(sendTemplateMessage).mockRejectedValue(new Error('rate limited'))
    mockPrisma.message.create.mockResolvedValue({ id: 'msg_1', deliveryStatus: 'FAILED' } as never)

    const res = await POST(req({ conversationId: 'conv_1', templateId: 't1' }))

    expect(res.status).toBe(200)
    expect(mockPrisma.message.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ deliveryStatus: 'FAILED' }) }))
    expect(consoleErrorSpy).toHaveBeenCalled()
    consoleErrorSpy.mockRestore()
  })
})

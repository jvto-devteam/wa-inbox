import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { GET, POST } from './route'
import { submitMetaTemplate, submitCarouselTemplate } from '@/lib/meta/templates'
import { verifySessionToken } from '@/lib/auth/session'

// `vi.mock` factories are hoisted above regular imports and `let`/`const`
// declarations, so the mock instance must be constructed inline inside the
// factory rather than via an outer variable reassigned in beforeEach.
vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/meta/templates', () => ({ submitMetaTemplate: vi.fn(), submitCarouselTemplate: vi.fn() }))
vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))

const adminCookie = { cookie: 'wa_inbox_session=tok' }

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

beforeEach(() => {
  mockReset(mockPrisma)
  vi.mocked(submitMetaTemplate).mockReset()
  vi.mocked(submitCarouselTemplate).mockReset()
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_admin', role: 'ADMIN', tokenVersion: 0 })
  delete process.env.META_APP_ID
})

describe('templates API', () => {
  it('GET lists all templates', async () => {
    mockPrisma.template.findMany.mockResolvedValue([{ id: 't1', name: 'booking_confirmation', type: 'OFFICIAL', metaStatus: 'PENDING' }] as never)
    const res = await GET()
    expect((await res.json())[0].name).toBe('booking_confirmation')
  })

  it('POST with type OFFICIAL submits to Meta and stores the pending status', async () => {
    mockPrisma.waNumber.findFirstOrThrow.mockResolvedValue({ wabaId: 'waba_1', accessToken: 'tok' } as never)
    vi.mocked(submitMetaTemplate).mockResolvedValue({ metaId: 'tpl_meta_1', status: 'PENDING' })
    mockPrisma.template.create.mockResolvedValue({ id: 't2', metaStatus: 'PENDING' } as never)

    const req = new Request('http://localhost/api/templates', {
      method: 'POST',
      headers: adminCookie,
      body: JSON.stringify({ name: 'booking_confirmation', type: 'OFFICIAL', category: 'UTILITY', body: 'Booking {{1}} dikonfirmasi.', variables: ['nama'] }),
    })
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(mockPrisma.template.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ metaStatus: 'PENDING' }) }))
  })

  it('POST with type OFFICIAL stores the metaId Meta returned', async () => {
    // Without the id there is no key to reconcile Meta's later (asynchronous)
    // approve/reject verdict against, so metaStatus would be stuck at PENDING forever.
    mockPrisma.waNumber.findFirstOrThrow.mockResolvedValue({ wabaId: 'waba_1', accessToken: 'tok' } as never)
    vi.mocked(submitMetaTemplate).mockResolvedValue({ metaId: '671551331431970', status: 'PENDING' })
    mockPrisma.template.create.mockResolvedValue({ id: 't2', metaId: '671551331431970', metaStatus: 'PENDING' } as never)

    const req = new Request('http://localhost/api/templates', {
      method: 'POST',
      headers: adminCookie,
      body: JSON.stringify({ name: 'booking_confirmation', type: 'OFFICIAL', category: 'UTILITY', body: 'Booking {{1}} dikonfirmasi.', variables: ['nama'] }),
    })
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(mockPrisma.template.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ metaId: '671551331431970', metaStatus: 'PENDING' }) })
    )
    expect((await res.json()).metaId).toBe('671551331431970')
  })

  it('POST with type QUICK_REPLY skips Meta entirely and stores a null metaId', async () => {
    mockPrisma.template.create.mockResolvedValue({ id: 't3', metaStatus: 'NOT_APPLICABLE' } as never)
    const req = new Request('http://localhost/api/templates', { method: 'POST', headers: adminCookie, body: JSON.stringify({ name: 'harga_paket', type: 'QUICK_REPLY', body: 'Info harga...', category: 'Paket & Harga' }) })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(submitMetaTemplate).not.toHaveBeenCalled()
    expect(mockPrisma.template.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ metaId: null, metaStatus: 'NOT_APPLICABLE' }) })
    )
  })

  it('POST with type OFFICIAL propagates a Meta submission failure without creating a local row', async () => {
    mockPrisma.waNumber.findFirstOrThrow.mockResolvedValue({ wabaId: 'waba_1', accessToken: 'tok' } as never)
    vi.mocked(submitMetaTemplate).mockRejectedValue(new Error('Meta Graph API error'))

    const req = new Request('http://localhost/api/templates', {
      method: 'POST',
      headers: adminCookie,
      body: JSON.stringify({ name: 'booking_confirmation', type: 'OFFICIAL', category: 'UTILITY', body: 'Booking {{1}} dikonfirmasi.', variables: ['nama'] }),
    })
    const res = await POST(req)

    expect(res.status).toBe(502)
    expect(mockPrisma.template.create).not.toHaveBeenCalled()
  })

  it('POST rejects a non-admin — an agent must not be able to submit templates under the company WABA', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_agent', role: 'AGENT', tokenVersion: 0 })
    const req = new Request('http://localhost/api/templates', {
      method: 'POST',
      headers: adminCookie,
      body: JSON.stringify({ name: 'x', type: 'OFFICIAL', category: 'UTILITY', body: 'x' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(403)
    expect(submitMetaTemplate).not.toHaveBeenCalled()
    expect(mockPrisma.template.create).not.toHaveBeenCalled()
  })

  it('POST rejects a request with no session cookie at all', async () => {
    const req = new Request('http://localhost/api/templates', {
      method: 'POST',
      body: JSON.stringify({ name: 'x', type: 'QUICK_REPLY', body: 'x' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(403)
    expect(mockPrisma.template.create).not.toHaveBeenCalled()
  })

  describe('carousel templates', () => {
    const card = {
      mediaType: 'IMAGE',
      mediaUrl: 'https://example.com/paket-ijen.jpg',
      bodyText: 'Paket Ijen 3D2N',
      buttons: [{ type: 'QUICK_REPLY', text: 'Pesan Sekarang' }],
    }

    beforeEach(() => {
      process.env.META_APP_ID = 'app_123'
    })

    it('submits a carousel template via submitCarouselTemplate and stores format + cards', async () => {
      mockPrisma.waNumber.findFirstOrThrow.mockResolvedValue({ wabaId: 'waba_1', accessToken: 'tok' } as never)
      vi.mocked(submitCarouselTemplate).mockResolvedValue({ metaId: 'tpl_carousel_1', status: 'PENDING' })
      mockPrisma.template.create.mockResolvedValue({ id: 't_carousel', format: 'CAROUSEL', metaStatus: 'PENDING' } as never)

      const req = new Request('http://localhost/api/templates', {
        method: 'POST',
        headers: adminCookie,
        body: JSON.stringify({
          name: 'katalog_paket', type: 'OFFICIAL', category: 'MARKETING', format: 'CAROUSEL',
          body: 'Halo, ini rekomendasi paket untuk Anda:', cards: [card],
        }),
      })
      const res = await POST(req)

      expect(res.status).toBe(200)
      expect(submitCarouselTemplate).toHaveBeenCalledWith(
        { wabaId: 'waba_1', accessToken: 'tok' },
        'app_123',
        expect.objectContaining({ name: 'katalog_paket', cards: [card] })
      )
      expect(submitMetaTemplate).not.toHaveBeenCalled()
      expect(mockPrisma.template.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ format: 'CAROUSEL', cards: [card], metaStatus: 'PENDING' }),
      }))
    })

    it('rejects a CAROUSEL format on a QUICK_REPLY template', async () => {
      const req = new Request('http://localhost/api/templates', {
        method: 'POST',
        headers: adminCookie,
        body: JSON.stringify({ name: 'x', type: 'QUICK_REPLY', format: 'CAROUSEL', body: 'x', cards: [card] }),
      })
      const res = await POST(req)
      expect(res.status).toBe(400)
      expect(submitCarouselTemplate).not.toHaveBeenCalled()
      expect(mockPrisma.template.create).not.toHaveBeenCalled()
    })

    it('rejects a CAROUSEL submission with no cards', async () => {
      const req = new Request('http://localhost/api/templates', {
        method: 'POST',
        headers: adminCookie,
        body: JSON.stringify({ name: 'x', type: 'OFFICIAL', format: 'CAROUSEL', body: 'x' }),
      })
      const res = await POST(req)
      expect(res.status).toBe(400)
      expect(mockPrisma.template.create).not.toHaveBeenCalled()
    })

    it('returns 500 without creating a row when META_APP_ID is not configured', async () => {
      delete process.env.META_APP_ID
      mockPrisma.waNumber.findFirstOrThrow.mockResolvedValue({ wabaId: 'waba_1', accessToken: 'tok' } as never)

      const req = new Request('http://localhost/api/templates', {
        method: 'POST',
        headers: adminCookie,
        body: JSON.stringify({ name: 'katalog_paket', type: 'OFFICIAL', format: 'CAROUSEL', body: 'Halo', cards: [card] }),
      })
      const res = await POST(req)

      expect(res.status).toBe(500)
      expect(submitCarouselTemplate).not.toHaveBeenCalled()
      expect(mockPrisma.template.create).not.toHaveBeenCalled()
    })

    it('propagates a carousel submission failure without creating a local row', async () => {
      mockPrisma.waNumber.findFirstOrThrow.mockResolvedValue({ wabaId: 'waba_1', accessToken: 'tok' } as never)
      vi.mocked(submitCarouselTemplate).mockRejectedValue(new Error('Invalid header handle'))

      const req = new Request('http://localhost/api/templates', {
        method: 'POST',
        headers: adminCookie,
        body: JSON.stringify({ name: 'katalog_paket', type: 'OFFICIAL', format: 'CAROUSEL', body: 'Halo', cards: [card] }),
      })
      const res = await POST(req)

      expect(res.status).toBe(502)
      expect(mockPrisma.template.create).not.toHaveBeenCalled()
    })
  })
})

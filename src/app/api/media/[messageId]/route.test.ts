import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { resolveMetaMediaUrl, downloadMetaMedia } from '@/lib/meta/media'
import { GET } from './route'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/meta/media', () => ({ resolveMetaMediaUrl: vi.fn(), downloadMetaMedia: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

beforeEach(() => {
  mockReset(mockPrisma)
  vi.mocked(resolveMetaMediaUrl).mockReset()
  vi.mocked(downloadMetaMedia).mockReset()
})

describe('GET /api/media/[messageId]', () => {
  it('404s when the message has no mediaId', async () => {
    mockPrisma.message.findUnique.mockResolvedValue({ id: 'msg_1', mediaId: null } as never)

    const res = await GET(new Request('http://localhost'), { params: Promise.resolve({ messageId: 'msg_1' }) })

    expect(res.status).toBe(404)
    expect(resolveMetaMediaUrl).not.toHaveBeenCalled()
  })

  it('404s when the message does not exist', async () => {
    mockPrisma.message.findUnique.mockResolvedValue(null)

    const res = await GET(new Request('http://localhost'), { params: Promise.resolve({ messageId: 'missing' }) })

    expect(res.status).toBe(404)
  })

  it('returns 500 when no WaNumber is configured', async () => {
    mockPrisma.message.findUnique.mockResolvedValue({ id: 'msg_1', mediaId: 'media_1' } as never)
    mockPrisma.waNumber.findFirst.mockResolvedValue(null)

    const res = await GET(new Request('http://localhost'), { params: Promise.resolve({ messageId: 'msg_1' }) })

    expect(res.status).toBe(500)
  })

  it('resolves and streams the media bytes with the stored mime type and filename', async () => {
    mockPrisma.message.findUnique.mockResolvedValue({
      id: 'msg_1', mediaId: 'media_1', mimeType: 'application/pdf', fileName: 'itinerary.pdf',
    } as never)
    mockPrisma.waNumber.findFirst.mockResolvedValue({ accessToken: 'tok' } as never)
    vi.mocked(resolveMetaMediaUrl).mockResolvedValue({ url: 'https://lookaside/x', mimeType: 'application/pdf' })
    const bytes = new TextEncoder().encode('fake-pdf-bytes').buffer
    vi.mocked(downloadMetaMedia).mockResolvedValue({ ok: true, arrayBuffer: async () => bytes } as unknown as Response)

    const res = await GET(new Request('http://localhost'), { params: Promise.resolve({ messageId: 'msg_1' }) })

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/pdf')
    expect(res.headers.get('Content-Disposition')).toContain('itinerary.pdf')
    expect(resolveMetaMediaUrl).toHaveBeenCalledWith('media_1', 'tok')
    expect(downloadMetaMedia).toHaveBeenCalledWith('https://lookaside/x', 'tok')
  })

  it('returns 502 when Meta fails to serve the media bytes', async () => {
    mockPrisma.message.findUnique.mockResolvedValue({ id: 'msg_1', mediaId: 'media_1', mimeType: null, fileName: null } as never)
    mockPrisma.waNumber.findFirst.mockResolvedValue({ accessToken: 'tok' } as never)
    vi.mocked(resolveMetaMediaUrl).mockResolvedValue({ url: 'https://lookaside/x', mimeType: 'image/jpeg' })
    vi.mocked(downloadMetaMedia).mockResolvedValue({ ok: false } as Response)

    const res = await GET(new Request('http://localhost'), { params: Promise.resolve({ messageId: 'msg_1' }) })

    expect(res.status).toBe(502)
  })

  it('returns 502 when resolving the media URL throws', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockPrisma.message.findUnique.mockResolvedValue({ id: 'msg_1', mediaId: 'media_1', mimeType: null, fileName: null } as never)
    mockPrisma.waNumber.findFirst.mockResolvedValue({ accessToken: 'tok' } as never)
    vi.mocked(resolveMetaMediaUrl).mockRejectedValue(new Error('media id expired'))

    const res = await GET(new Request('http://localhost'), { params: Promise.resolve({ messageId: 'msg_1' }) })

    expect(res.status).toBe(502)
    expect(consoleErrorSpy).toHaveBeenCalled()
  })
})

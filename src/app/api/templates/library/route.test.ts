import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { verifySessionToken } from '@/lib/auth/session'
import { getTemplateLibrary } from '@/lib/meta/templates'
import { GET } from './route'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))
vi.mock('@/lib/meta/templates', () => ({ getTemplateLibrary: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>
const adminCookie = { cookie: 'wa_inbox_session=tok' }

beforeEach(() => {
  mockReset(mockPrisma)
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_admin', role: 'ADMIN', tokenVersion: 0 })
  vi.mocked(getTemplateLibrary).mockReset()
  mockPrisma.waNumber.findFirstOrThrow.mockResolvedValue({ accessToken: 'tok' } as never)
})

describe('GET /api/templates/library', () => {
  it('passes query params through to getTemplateLibrary', async () => {
    vi.mocked(getTemplateLibrary).mockResolvedValue({ templates: [], nextCursor: null })

    await GET(new Request('http://localhost/api/templates/library?category=UTILITY&language=en_US&q=booking', { headers: adminCookie }))

    expect(getTemplateLibrary).toHaveBeenCalledWith('tok', {
      category: 'UTILITY', language: 'en_US', nameOrContent: 'booking', after: undefined,
    })
  })

  it('returns the library results', async () => {
    vi.mocked(getTemplateLibrary).mockResolvedValue({
      templates: [{ id: '1', name: 'booking_confirm', category: 'UTILITY', language: 'en_US', header: null, body: 'Hi {{1}}', buttons: [] }],
      nextCursor: 'abc',
    })

    const res = await GET(new Request('http://localhost/api/templates/library', { headers: adminCookie }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.templates).toHaveLength(1)
    expect(body.nextCursor).toBe('abc')
  })

  it('rejects a non-admin', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_agent', role: 'AGENT', tokenVersion: 0 })
    const res = await GET(new Request('http://localhost/api/templates/library', { headers: adminCookie }))
    expect(res.status).toBe(403)
    expect(getTemplateLibrary).not.toHaveBeenCalled()
  })

  it('returns 502 when Meta fails', async () => {
    vi.mocked(getTemplateLibrary).mockRejectedValue(new Error('Meta Graph API error'))
    const res = await GET(new Request('http://localhost/api/templates/library', { headers: adminCookie }))
    expect(res.status).toBe(502)
  })
})

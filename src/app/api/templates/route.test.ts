import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { GET, POST } from './route'
import { submitMetaTemplate } from '@/lib/meta/templates'

// `vi.mock` factories are hoisted above regular imports and `let`/`const`
// declarations, so the mock instance must be constructed inline inside the
// factory rather than via an outer variable reassigned in beforeEach.
vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/meta/templates', () => ({ submitMetaTemplate: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

beforeEach(() => {
  mockReset(mockPrisma)
  vi.mocked(submitMetaTemplate).mockReset()
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
      body: JSON.stringify({ name: 'booking_confirmation', type: 'OFFICIAL', category: 'UTILITY', body: 'Booking {{1}} dikonfirmasi.', variables: ['nama'] }),
    })
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(mockPrisma.template.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ metaStatus: 'PENDING' }) }))
  })

  it('POST with type QUICK_REPLY skips Meta entirely', async () => {
    mockPrisma.template.create.mockResolvedValue({ id: 't3', metaStatus: 'NOT_APPLICABLE' } as never)
    const req = new Request('http://localhost/api/templates', { method: 'POST', body: JSON.stringify({ name: 'harga_paket', type: 'QUICK_REPLY', body: 'Info harga...', category: 'Paket & Harga' }) })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(submitMetaTemplate).not.toHaveBeenCalled()
  })

  it('POST with type OFFICIAL propagates a Meta submission failure without creating a local row', async () => {
    mockPrisma.waNumber.findFirstOrThrow.mockResolvedValue({ wabaId: 'waba_1', accessToken: 'tok' } as never)
    vi.mocked(submitMetaTemplate).mockRejectedValue(new Error('Meta Graph API error'))

    const req = new Request('http://localhost/api/templates', {
      method: 'POST',
      body: JSON.stringify({ name: 'booking_confirmation', type: 'OFFICIAL', category: 'UTILITY', body: 'Booking {{1}} dikonfirmasi.', variables: ['nama'] }),
    })
    const res = await POST(req)

    expect(res.status).toBe(502)
    expect(mockPrisma.template.create).not.toHaveBeenCalled()
  })
})

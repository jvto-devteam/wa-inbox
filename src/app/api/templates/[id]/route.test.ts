import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { verifySessionToken } from '@/lib/auth/session'
import { deleteMetaTemplate } from '@/lib/meta/templates'
import { GET, DELETE } from './route'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))
vi.mock('@/lib/meta/templates', () => ({ deleteMetaTemplate: vi.fn() }))

const adminCookie = { cookie: 'wa_inbox_session=tok' }

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

beforeEach(() => {
  mockReset(mockPrisma)
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_admin', role: 'ADMIN', tokenVersion: 0 })
  vi.mocked(deleteMetaTemplate).mockReset().mockResolvedValue(undefined)
})

describe('GET /api/templates/[id]', () => {
  it('returns the template when found', async () => {
    mockPrisma.template.findUnique.mockResolvedValue({ id: 't1', name: 'harga_paket', type: 'QUICK_REPLY' } as never)
    const res = await GET(new Request('http://localhost'), { params: Promise.resolve({ id: 't1' }) })
    expect(res.status).toBe(200)
    expect((await res.json()).name).toBe('harga_paket')
  })

  it('returns 404 when the template does not exist', async () => {
    mockPrisma.template.findUnique.mockResolvedValue(null)
    const res = await GET(new Request('http://localhost'), { params: Promise.resolve({ id: 'missing' }) })
    expect(res.status).toBe(404)
  })
})

describe('DELETE /api/templates/[id]', () => {
  it('deletes a QUICK_REPLY template locally only -- it never reached Meta', async () => {
    mockPrisma.template.findUnique.mockResolvedValue({ id: 't1', type: 'QUICK_REPLY', name: 'harga_paket', metaId: null } as never)
    mockPrisma.template.delete.mockResolvedValue({} as never)

    const res = await DELETE(new Request('http://localhost', { headers: adminCookie }), { params: Promise.resolve({ id: 't1' }) })

    expect(res.status).toBe(200)
    expect(deleteMetaTemplate).not.toHaveBeenCalled()
    expect(mockPrisma.template.delete).toHaveBeenCalledWith({ where: { id: 't1' } })
  })

  it('deletes an OFFICIAL template on Meta first, then locally', async () => {
    mockPrisma.template.findUnique.mockResolvedValue({ id: 't2', type: 'OFFICIAL', name: 'booking_confirmation', metaId: 'tpl_meta_1' } as never)
    mockPrisma.waNumber.findFirstOrThrow.mockResolvedValue({ wabaId: 'waba_1', accessToken: 'tok' } as never)
    mockPrisma.template.delete.mockResolvedValue({} as never)

    const res = await DELETE(new Request('http://localhost', { headers: adminCookie }), { params: Promise.resolve({ id: 't2' }) })

    expect(res.status).toBe(200)
    expect(deleteMetaTemplate).toHaveBeenCalledWith({ wabaId: 'waba_1', accessToken: 'tok' }, 'booking_confirmation')
    expect(mockPrisma.template.delete).toHaveBeenCalledWith({ where: { id: 't2' } })
  })

  it('does not call Meta for an OFFICIAL template that never actually reached it (no metaId)', async () => {
    mockPrisma.template.findUnique.mockResolvedValue({ id: 't3', type: 'OFFICIAL', name: 'draft_only', metaId: null } as never)
    mockPrisma.template.delete.mockResolvedValue({} as never)

    const res = await DELETE(new Request('http://localhost', { headers: adminCookie }), { params: Promise.resolve({ id: 't3' }) })

    expect(res.status).toBe(200)
    expect(deleteMetaTemplate).not.toHaveBeenCalled()
    expect(mockPrisma.template.delete).toHaveBeenCalledWith({ where: { id: 't3' } })
  })

  it('returns 404 when the template does not exist', async () => {
    mockPrisma.template.findUnique.mockResolvedValue(null)
    const res = await DELETE(new Request('http://localhost', { headers: adminCookie }), { params: Promise.resolve({ id: 'missing' }) })
    expect(res.status).toBe(404)
    expect(mockPrisma.template.delete).not.toHaveBeenCalled()
  })

  it('leaves the local row in place when the Meta deletion fails, so the admin can retry', async () => {
    mockPrisma.template.findUnique.mockResolvedValue({ id: 't4', type: 'OFFICIAL', name: 'booking_confirmation', metaId: 'tpl_meta_1' } as never)
    mockPrisma.waNumber.findFirstOrThrow.mockResolvedValue({ wabaId: 'waba_1', accessToken: 'tok' } as never)
    vi.mocked(deleteMetaTemplate).mockRejectedValue(new Error('Meta Graph API error'))

    const res = await DELETE(new Request('http://localhost', { headers: adminCookie }), { params: Promise.resolve({ id: 't4' }) })

    expect(res.status).toBe(502)
    expect(mockPrisma.template.delete).not.toHaveBeenCalled()
  })
})

describe('admin-only guards on /api/templates/[id]', () => {
  it('DELETE rejects a non-admin — an agent must not be able to remove a template others rely on', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_agent', role: 'AGENT', tokenVersion: 0 })
    const res = await DELETE(new Request('http://localhost', { headers: adminCookie }), { params: Promise.resolve({ id: 't1' }) })
    expect(res.status).toBe(403)
    expect(mockPrisma.template.delete).not.toHaveBeenCalled()
  })

  it('DELETE rejects a request with no session cookie at all', async () => {
    const res = await DELETE(new Request('http://localhost'), { params: Promise.resolve({ id: 't1' }) })
    expect(res.status).toBe(403)
    expect(mockPrisma.template.delete).not.toHaveBeenCalled()
  })
})

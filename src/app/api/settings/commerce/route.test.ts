import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { verifySessionToken } from '@/lib/auth/session'
import { getCommerceSettings, updateCommerceSettings } from '@/lib/meta/business-account'
import { GET, PATCH } from './route'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))
vi.mock('@/lib/meta/business-account', () => ({ getCommerceSettings: vi.fn(), updateCommerceSettings: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>
const adminCookie = { cookie: 'wa_inbox_session=tok' }

beforeEach(() => {
  mockReset(mockPrisma)
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_admin', role: 'ADMIN', tokenVersion: 0 })
  vi.mocked(getCommerceSettings).mockReset()
  vi.mocked(updateCommerceSettings).mockReset()
  mockPrisma.waNumber.findFirstOrThrow.mockResolvedValue({ phoneNumberId: 'pnid_1', accessToken: 'tok' } as never)
})

describe('GET /api/settings/commerce', () => {
  it('returns the current cart/catalog flags', async () => {
    vi.mocked(getCommerceSettings).mockResolvedValue({ isCartEnabled: true, isCatalogVisible: false })
    const res = await GET(new Request('http://localhost', { headers: adminCookie }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ isCartEnabled: true, isCatalogVisible: false })
  })

  it('rejects a non-admin', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_agent', role: 'AGENT', tokenVersion: 0 })
    const res = await GET(new Request('http://localhost', { headers: adminCookie }))
    expect(res.status).toBe(403)
    expect(getCommerceSettings).not.toHaveBeenCalled()
  })
})

describe('PATCH /api/settings/commerce', () => {
  it('updates the flags then returns the fresh copy', async () => {
    vi.mocked(updateCommerceSettings).mockResolvedValue(undefined)
    vi.mocked(getCommerceSettings).mockResolvedValue({ isCartEnabled: false, isCatalogVisible: false })

    const req = new Request('http://localhost', { method: 'PATCH', headers: adminCookie, body: JSON.stringify({ isCartEnabled: false }) })
    const res = await PATCH(req)

    expect(res.status).toBe(200)
    expect(updateCommerceSettings).toHaveBeenCalledWith({ phoneNumberId: 'pnid_1', accessToken: 'tok' }, { isCartEnabled: false })
  })

  it('rejects a non-admin', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_agent', role: 'AGENT', tokenVersion: 0 })
    const req = new Request('http://localhost', { method: 'PATCH', headers: adminCookie, body: JSON.stringify({ isCartEnabled: true }) })
    const res = await PATCH(req)
    expect(res.status).toBe(403)
    expect(updateCommerceSettings).not.toHaveBeenCalled()
  })
})

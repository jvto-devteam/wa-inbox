import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { verifySessionToken } from '@/lib/auth/session'
import { getBusinessProfile, updateBusinessProfile, getBusinessAccountDetails } from '@/lib/meta/business-account'
import { GET, PATCH } from './route'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))
vi.mock('@/lib/meta/business-account', () => ({
  getBusinessProfile: vi.fn(),
  updateBusinessProfile: vi.fn(),
  getBusinessAccountDetails: vi.fn(),
  BUSINESS_VERTICALS: ['OTHER', 'TRAVEL'],
}))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>
const adminCookie = { cookie: 'wa_inbox_session=tok' }

beforeEach(() => {
  mockReset(mockPrisma)
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_admin', role: 'ADMIN', tokenVersion: 0 })
  vi.mocked(getBusinessProfile).mockReset()
  vi.mocked(updateBusinessProfile).mockReset()
  vi.mocked(getBusinessAccountDetails).mockReset()
  mockPrisma.waNumber.findFirstOrThrow.mockResolvedValue({ phoneNumberId: 'pnid_1', wabaId: 'waba_1', accessToken: 'tok' } as never)
})

describe('GET /api/settings/business-profile', () => {
  it('returns the profile and account status together', async () => {
    vi.mocked(getBusinessProfile).mockResolvedValue({
      about: 'Halo', address: null, description: null, email: null, vertical: 'TRAVEL', websites: [], profilePictureUrl: null,
    })
    vi.mocked(getBusinessAccountDetails).mockResolvedValue({
      id: 'waba_1', name: 'JVTO', timezoneId: '66', accountReviewStatus: 'APPROVED', businessVerificationStatus: 'verified',
    })

    const res = await GET(new Request('http://localhost', { headers: adminCookie }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.profile.about).toBe('Halo')
    expect(body.account.accountReviewStatus).toBe('APPROVED')
  })

  it('rejects a non-admin', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_agent', role: 'AGENT', tokenVersion: 0 })
    const res = await GET(new Request('http://localhost', { headers: adminCookie }))
    expect(res.status).toBe(403)
    expect(getBusinessProfile).not.toHaveBeenCalled()
  })

  it('returns 502 when Meta fails', async () => {
    vi.mocked(getBusinessProfile).mockRejectedValue(new Error('Meta Graph API error'))
    const res = await GET(new Request('http://localhost', { headers: adminCookie }))
    expect(res.status).toBe(502)
  })
})

describe('PATCH /api/settings/business-profile', () => {
  it('updates the profile then returns the fresh copy', async () => {
    vi.mocked(updateBusinessProfile).mockResolvedValue(undefined)
    vi.mocked(getBusinessProfile).mockResolvedValue({
      about: 'Halo baru', address: null, description: null, email: null, vertical: null, websites: [], profilePictureUrl: null,
    })

    const req = new Request('http://localhost', { method: 'PATCH', headers: adminCookie, body: JSON.stringify({ about: 'Halo baru' }) })
    const res = await PATCH(req)

    expect(res.status).toBe(200)
    expect(updateBusinessProfile).toHaveBeenCalledWith({ phoneNumberId: 'pnid_1', wabaId: 'waba_1', accessToken: 'tok' }, { about: 'Halo baru' })
    expect((await res.json()).profile.about).toBe('Halo baru')
  })

  it('rejects a non-admin', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_agent', role: 'AGENT', tokenVersion: 0 })
    const req = new Request('http://localhost', { method: 'PATCH', headers: adminCookie, body: JSON.stringify({ about: 'x' }) })
    const res = await PATCH(req)
    expect(res.status).toBe(403)
    expect(updateBusinessProfile).not.toHaveBeenCalled()
  })

  it('returns 502 when Meta rejects the update', async () => {
    vi.mocked(updateBusinessProfile).mockRejectedValue(new Error('Invalid parameter'))
    const req = new Request('http://localhost', { method: 'PATCH', headers: adminCookie, body: JSON.stringify({ about: 'x' }) })
    const res = await PATCH(req)
    expect(res.status).toBe(502)
  })
})

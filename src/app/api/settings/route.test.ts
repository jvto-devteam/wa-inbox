import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { verifySessionToken } from '@/lib/auth/session'
import { GET, PATCH } from './route'

// `vi.mock` factories are hoisted above regular imports and `let`/`const`
// declarations, so the mock instance must be constructed inline inside the
// factory rather than via an outer variable — otherwise the factory throws
// "Cannot access ... before initialization".
vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

const adminCookie = { cookie: 'wa_inbox_session=tok' }

beforeEach(() => {
  mockReset(mockPrisma)
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_admin', role: 'ADMIN', tokenVersion: 0 })
})

describe('GET /api/settings', () => {
  it('returns the singleton settings row', async () => {
    mockPrisma.settings.findUniqueOrThrow.mockResolvedValue({
      id: 1,
      defaultChannel: 'OFFICIAL',
      workingHoursStart: null,
      workingHoursEnd: null,
      offHoursAutoReply: null,
      botKillSwitch: false,
      catalogSyncedAt: null,
    } as never)

    const res = await GET()

    expect((await res.json()).defaultChannel).toBe('OFFICIAL')
  })
})

describe('PATCH /api/settings', () => {
  it('updates defaultChannel when called by an admin', async () => {
    mockPrisma.settings.update.mockResolvedValue({ id: 1, defaultChannel: 'UNOFFICIAL' } as never)

    const req = new Request('http://localhost/api/settings', {
      method: 'PATCH',
      headers: adminCookie,
      body: JSON.stringify({ defaultChannel: 'UNOFFICIAL' }),
    })
    const res = await PATCH(req)

    expect((await res.json()).defaultChannel).toBe('UNOFFICIAL')
  })

  it('updates ollamaModel and openaiModel when called by an admin', async () => {
    mockPrisma.settings.update.mockResolvedValue({ id: 1, ollamaModel: 'mistral', openaiModel: 'gpt-4o' } as never)

    const req = new Request('http://localhost/api/settings', {
      method: 'PATCH',
      headers: adminCookie,
      body: JSON.stringify({ ollamaModel: 'mistral', openaiModel: 'gpt-4o' }),
    })
    const res = await PATCH(req)

    expect(res.status).toBe(200)
    expect(mockPrisma.settings.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { ollamaModel: 'mistral', openaiModel: 'gpt-4o' },
    })
  })

  it('rejects invalid payloads', async () => {
    const req = new Request('http://localhost/api/settings', {
      method: 'PATCH',
      headers: adminCookie,
      body: JSON.stringify({ defaultChannel: 'NOT_A_CHANNEL' }),
    })
    const res = await PATCH(req)

    expect(res.status).toBe(400)
    expect(mockPrisma.settings.update).not.toHaveBeenCalled()
  })

  it('rejects when the caller is not an admin', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_agent', role: 'AGENT', tokenVersion: 0 })
    const req = new Request('http://localhost/api/settings', {
      method: 'PATCH',
      headers: adminCookie,
      body: JSON.stringify({ defaultChannel: 'UNOFFICIAL' }),
    })
    const res = await PATCH(req)

    expect(res.status).toBe(403)
    expect(mockPrisma.settings.update).not.toHaveBeenCalled()
  })

  it('rejects when there is no session cookie at all', async () => {
    const req = new Request('http://localhost/api/settings', {
      method: 'PATCH',
      body: JSON.stringify({ defaultChannel: 'UNOFFICIAL' }),
    })
    const res = await PATCH(req)

    expect(res.status).toBe(403)
    expect(mockPrisma.settings.update).not.toHaveBeenCalled()
  })
})

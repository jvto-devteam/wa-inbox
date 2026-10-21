import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/get-session', () => ({ getSession: vi.fn() }))

import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'
import { POST } from './route'

const db = prisma as unknown as DeepMockProxy<PrismaClient>
const call = (body: unknown) =>
  POST(new Request('http://localhost', { method: 'POST', body: JSON.stringify(body) }), { params: Promise.resolve({ id: 'c1' }) })

beforeEach(() => {
  mockReset(db)
  vi.mocked(getSession).mockResolvedValue({ accountId: 'a1' } as never)
  process.env.BOOKING_ACTIONS_TEST_PHONES = '6282143403501'
})
afterEach(() => {
  delete process.env.BOOKING_ACTIONS_TEST_PHONES
})

describe('POST /api/conversations/[id]/dry-run', () => {
  it('turns Mode uji tanpa WA on for a whitelisted number', async () => {
    db.conversation.findUnique.mockResolvedValue({ isTest: false, contact: { phone: '6282143403501' } } as never)
    db.conversation.update.mockResolvedValue({ dryRun: true } as never)
    const res = await call({ enabled: true })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ dryRun: true })
    expect(db.conversation.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'c1' }, data: { dryRun: true } }))
  })

  it('refuses a real customer number and the sandbox, without writing', async () => {
    db.conversation.findUnique.mockResolvedValue({ isTest: false, contact: { phone: '4915112345678' } } as never)
    expect((await call({ enabled: true })).status).toBe(403)
    db.conversation.findUnique.mockResolvedValue({ isTest: true, contact: { phone: '__bot_test__' } } as never)
    expect((await call({ enabled: true })).status).toBe(403)
    expect(db.conversation.update).not.toHaveBeenCalled()
  })

  it('401 without a session, 400 on a bad body', async () => {
    vi.mocked(getSession).mockResolvedValueOnce(null)
    expect((await call({ enabled: true })).status).toBe(401)
    expect((await call({ enabled: 'yes' })).status).toBe(400)
  })
})

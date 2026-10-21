import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))

import { prisma } from '@/lib/db'
import { vendorDestination } from './vendor-destination'

const db = prisma as unknown as DeepMockProxy<PrismaClient>
const conv = (over: Record<string, unknown>) => ({ isTest: false, dryRun: false, contact: { phone: '6282143403501' }, ...over })

beforeEach(() => {
  mockReset(db)
  process.env.BOOKING_ACTIONS_TEST_PHONES = '6282143403501'
})
afterEach(() => {
  delete process.env.BOOKING_ACTIONS_TEST_PHONES
  delete process.env.BOOKING_ACTIONS_ROLLOUT
})

describe('vendorDestination', () => {
  it('Mode uji tanpa WA (dryRun) -> simulate, in rollout test AND all: no WhatsApp to the vendor nor the test phone', async () => {
    db.conversation.findUnique.mockResolvedValue(conv({ dryRun: true }) as never)
    expect(await vendorDestination('c1', '6281337844825')).toEqual({ simulate: true })
    process.env.BOOKING_ACTIONS_ROLLOUT = 'all'
    expect(await vendorDestination('c1', '6281337844825')).toEqual({ simulate: true })
  })

  it('without dryRun: test conversation -> first test phone; rollout all -> the real vendor', async () => {
    db.conversation.findUnique.mockResolvedValue(conv({}) as never)
    expect(await vendorDestination('c1', '6281337844825')).toEqual({ phone: '6282143403501', test: true })
    process.env.BOOKING_ACTIONS_ROLLOUT = 'all'
    expect(await vendorDestination('c1', '6281337844825')).toEqual({ phone: '6281337844825', test: false })
  })
})

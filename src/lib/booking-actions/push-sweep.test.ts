/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/push/send', async (orig) => ({ ...(await orig<typeof import('@/lib/push/send')>()), notifyBookingAction: vi.fn(), pushMarkFailedRecently: vi.fn().mockReturnValue(false) }))

import { prisma } from '@/lib/db'
import { notifyBookingAction, pushMarkFailedRecently } from '@/lib/push/send'
import { PUSH_SWEEP_MAX_AGE_MS, PUSH_SWEEP_MIN_AGE_MS, pushUnnotifiedChanges } from './push-sweep'

const db = prisma as unknown as DeepMockProxy<PrismaClient>
const NOW = new Date('2026-10-20T03:00:00Z')
const CREATED = new Date('2026-10-20T02:30:00Z')
const card = (id: string, createdAt = CREATED) => ({ id, conversationId: 'c1', field: 'pickup_time', proposedValue: '09:00', sourceMessageId: 'm1', createdAt, conversation: { bookingData: { id: 'JVTO-3899' } } })

beforeEach(() => {
  mockReset(db)
  vi.mocked(notifyBookingAction).mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('pushUnnotifiedChanges', () => {
  it('OPEN CHANGE cards 2 min .. 1 h old without a PUSHED marker get one CHANGE push; marked ones none', async () => {
    db.bookingAction.findMany.mockResolvedValue([card('a1'), card('a2')] as never)
    db.bookingActionEvent.findMany.mockResolvedValue([{ actionId: 'a2' }] as never)
    expect(await pushUnnotifiedChanges(NOW)).toBe(1)
    expect(db.bookingAction.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        type: 'CHANGE', state: 'OPEN',
        updatedAt: { lt: new Date(NOW.getTime() - PUSH_SWEEP_MIN_AGE_MS), gte: new Date(NOW.getTime() - PUSH_SWEEP_MAX_AGE_MS) },
      },
    }))
    // Penanda dicari terbatas waktu: tidak lebih tua dari kartu tertua.
    expect(db.bookingActionEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { actionId: { in: ['a1', 'a2'] }, event: 'PUSHED', createdAt: { gte: CREATED } },
    }))
    expect(notifyBookingAction).toHaveBeenCalledTimes(1)
    expect(notifyBookingAction).toHaveBeenCalledWith({
      kind: 'CHANGE', conversationId: 'c1', bookingCode: 'JVTO-3899', summary: 'Jam jemput → 09:00', actionId: 'a1', messageId: 'm1',
    })
  })

  it('a card whose PUSHED marker failed to write recently is not re-pushed every tick', async () => {
    db.bookingAction.findMany.mockResolvedValue([card('a1')] as never)
    db.bookingActionEvent.findMany.mockResolvedValue([] as never)
    vi.mocked(pushMarkFailedRecently).mockReturnValueOnce(true)
    expect(await pushUnnotifiedChanges(NOW)).toBe(0)
    expect(notifyBookingAction).not.toHaveBeenCalled()
  })

  it('nothing to sweep -> no marker query; a DB error never throws', async () => {
    db.bookingAction.findMany.mockResolvedValue([] as never)
    expect(await pushUnnotifiedChanges(NOW)).toBe(0)
    expect(db.bookingActionEvent.findMany).not.toHaveBeenCalled()
    db.bookingAction.findMany.mockRejectedValue(new Error('down'))
    await expect(pushUnnotifiedChanges(NOW)).resolves.toBe(0)
  })
})

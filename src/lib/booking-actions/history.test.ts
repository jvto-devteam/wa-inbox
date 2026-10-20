/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { Prisma, PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { REDACTED } from '@/lib/bot-control/trace-sanitizer'
import { recordEvent, type BookingEventInput } from './history'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>
/** Objek berbeda, seperti yang diberikan `$transaction` -- bukan client bersama. */
const mockTx = mockDeep<Prisma.TransactionClient>()

const base: BookingEventInput = { conversationId: 'c1', event: 'CREATED', actor: 'BOT' }

beforeEach(() => {
  mockReset(mockPrisma)
  mockReset(mockTx)
  vi.clearAllMocks()
  mockPrisma.bookingActionEvent.create.mockResolvedValue({ id: 'e1' } as never)
  mockTx.bookingActionEvent.create.mockResolvedValue({ id: 'e1' } as never)
})

describe('recordEvent', () => {
  it('recordEvent sanitizes reason', async () => {
    await recordEvent(prisma, { ...base, reason: 'gagal: Authorization: Bearer abcdef1234567890' })

    const { reason } = mockPrisma.bookingActionEvent.create.mock.calls[0][0].data
    expect(reason).not.toContain('abcdef1234567890')
    expect(reason).toContain(REDACTED)
  })

  it('writes the event columns as given', async () => {
    await recordEvent(prisma, {
      ...base,
      bookingId: 'b1',
      actionId: 'a1',
      accountId: 'u1',
      oldValue: { v: 1 },
      newValue: { v: 2 },
      sourceMessageId: 'm1',
    })

    expect(mockPrisma.bookingActionEvent.create.mock.calls[0][0].data).toMatchObject({
      conversationId: 'c1',
      bookingId: 'b1',
      actionId: 'a1',
      event: 'CREATED',
      actor: 'BOT',
      accountId: 'u1',
      sourceMessageId: 'm1',
    })
  })

  it('recordEvent throws inside transaction', async () => {
    mockTx.bookingActionEvent.create.mockRejectedValue(new Error('db down'))
    await expect(recordEvent(mockTx, base)).rejects.toThrow('db down')
  })

  it('recordEvent swallows standalone', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockPrisma.bookingActionEvent.create.mockRejectedValue(new Error('db down'))
    await expect(recordEvent(prisma, base)).resolves.toBeUndefined()
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})

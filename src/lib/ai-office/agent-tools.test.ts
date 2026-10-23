import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/realtime', () => ({ broadcast: vi.fn() }))
vi.mock('@/lib/booking-actions/execute', () => ({ executeBookingAction: vi.fn() }))
vi.mock('@/lib/booking-actions/history', () => ({ recordEvent: vi.fn() }))

import { prisma } from '@/lib/db'
import { executeBookingAction } from '@/lib/booking-actions/execute'
import { ALL_ACTIONS, findAction } from './agent-tools'

const db = prisma as unknown as DeepMockProxy<PrismaClient>
const ubah = findAction('ubah_booking')!
const booking = { id: 'JVTO-3752', booking_id: 3752, pickup: { point: 'Surabaya Hotel', detail: 'Riverview', time: '10:00' } }
const conv = (bookingData: unknown = booking) => ({ id: 'c1', bookingData, contact: { name: 'David Setya', phone: '6282143403501' } })

beforeEach(() => {
  mockReset(db)
  vi.mocked(executeBookingAction).mockReset()
})

describe('aksi Kantor AI', () => {
  it('setiap aksi punya pengerja; ubah booking milik Samsul (booking)', () => {
    expect(ubah.owner).toBe('booking')
    expect(new Set(ALL_ACTIONS.map((a) => a.name)).size).toBe(ALL_ACTIONS.length)
  })

  it('ubah_booking: jam dinormalkan, konfirmasi menyebut nilai lama → baru dan bahwa tamu dikabari', async () => {
    db.conversation.findUnique.mockResolvedValue(conv() as never)
    const args = ubah.args.parse({ conversationId: 'c1', field: 'pickup_time', nilai: 'jam 11' })
    const check = await ubah.describe(args)
    expect(check.ok).toBe(true)
    expect(check.ok && check.summary).toMatch(/JVTO-3752 \(David Setya\): .* → 11:00 · tamu dikabari/)
    expect(check.ok && check.summary).not.toContain('6282143403501')
  })

  it('ubah_booking: chat tanpa booking, nilai tak terbaca, dan pindah ke Bali ditolak', async () => {
    db.conversation.findUnique.mockResolvedValueOnce(conv(null) as never)
    expect(await ubah.describe({ conversationId: 'c1', field: 'pickup_time', nilai: '11:00' })).toEqual({ ok: false, error: 'Chat ini tidak tertaut ke booking' })
    db.conversation.findUnique.mockResolvedValueOnce(conv() as never)
    expect((await ubah.describe({ conversationId: 'c1', field: 'pickup_time', nilai: 'besok' })).ok).toBe(false)
    db.conversation.findUnique.mockResolvedValueOnce(conv() as never)
    expect(await ubah.describe({ conversationId: 'c1', field: 'pickup_point', nilai: 'Bali Hotel' })).toEqual({ ok: false, error: 'Pindah Surabaya ↔ Bali harus diubah admin di backoffice' })
  })

  it('ubah_booking: membuat kartu CHANGE lalu menulis lewat executeBookingAction atas nama operator', async () => {
    db.conversation.findUnique.mockResolvedValue(conv() as never)
    db.bookingAction.findFirst.mockResolvedValue(null)
    db.$transaction.mockImplementation(async (fn: unknown) => (fn as (tx: typeof db) => Promise<unknown>)(db))
    db.bookingAction.create.mockResolvedValue({ id: 'k9' } as never)
    vi.mocked(executeBookingAction).mockResolvedValue({ status: 200, body: { ok: true, state: 'EXECUTED', executed: ['pickup_time'], written: [] } } as never)
    const res = await ubah.run({ conversationId: 'c1', field: 'pickup_time', nilai: '11:00' }, { now: new Date(), isAdmin: false, accountId: 'a1' })
    expect(db.bookingAction.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ conversationId: 'c1', type: 'CHANGE', field: 'pickup_time', proposedValue: '11:00', state: 'OPEN', bookingId: '3752' }) })
    )
    expect(executeBookingAction).toHaveBeenCalledWith(expect.objectContaining({ actionId: 'k9', accountId: 'a1' }))
    expect(res).toEqual({ result: expect.stringContaining('11:00'), conversationId: 'c1' })
  })

  it('ubah_booking: gagal tulis dilaporkan, kartunya tetap ada di Inbox', async () => {
    db.conversation.findUnique.mockResolvedValue(conv() as never)
    db.bookingAction.findFirst.mockResolvedValue({ id: 'k1' } as never)
    vi.mocked(executeBookingAction).mockResolvedValue({ status: 503, body: { error: 'Data booking belum bisa diperiksa' } } as never)
    const res = await ubah.run({ conversationId: 'c1', field: 'pickup_time', nilai: '11:00' }, { now: new Date(), isAdmin: false, accountId: 'a1' })
    expect(db.bookingAction.create).not.toHaveBeenCalled()
    expect(res.result).toContain('belum tertulis')
  })
})

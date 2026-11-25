/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))

import { prisma } from '@/lib/db'
import { syncAgentSchedule } from './sync'

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>
const NOW = new Date('2026-11-25T03:30:00Z') // 10:30 WIB
const item = (key: string, o: Record<string, unknown> = {}) => ({
  key, kind: 'trip_information', booking_id: 1, booking_code: 'JVTO-1', booking_status: 'booked', guest_name: 'Emma R.',
  guest_phone: '+44 7700 900123', recipient: 'tamu', send_at: '2026-11-26T20:00:00+07:00', status: 'scheduled', ...o,
})
const env = { url: process.env.BOOKING_API_URL, key: process.env.BOOKING_API_KEY }

beforeEach(() => {
  mockReset(mockPrisma)
  process.env.BOOKING_API_URL = 'https://nb.test/internal/bookings?x=1'
  process.env.BOOKING_API_KEY = 'k'
  mockPrisma.$transaction.mockResolvedValue([] as never)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllGlobals()
  process.env.BOOKING_API_URL = env.url
  process.env.BOOKING_API_KEY = env.key
})

const stub = (status: number, body: unknown) => {
  const fn = vi.fn(async () => ({ ok: status < 400, status, json: async () => body }) as Response)
  vi.stubGlobal('fetch', fn)
  return fn
}

describe('syncAgentSchedule', () => {
  it('memanggil endpoint backoffice dengan token dan jendela kemarin..+7 hari, lalu upsert + hapus yang hilang', async () => {
    const fn = stub(200, { items: [item('trip_information:1'), item('payment_reminder:4', { kind: 'payment_reminder', guest_phone: null })] })
    mockPrisma.channelIdentity.findMany.mockResolvedValue([{ externalId: '447700900123', conversations: [{ id: 'c1' }] }] as never)

    const r = await syncAgentSchedule(NOW)

    expect(r).toEqual({ status: 'ok', upserted: 2 })
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://nb.test/wa-inbox-api/upcoming-reminders?from=2026-11-24&to=2026-12-02')
    expect((init.headers as Record<string, string>)['x-internal-token']).toBe('k')
    expect(mockPrisma.channelIdentity.findMany.mock.calls[0][0]).toMatchObject({ where: { platform: 'WHATSAPP', externalId: { in: ['447700900123'] } } })
    const up = mockPrisma.agentSchedule.upsert.mock.calls.map((c) => c[0])
    expect(up[0]).toMatchObject({ where: { key: 'trip_information:1' }, create: { phoneTail: '0123', conversationId: 'c1', sendAt: new Date('2026-11-26T13:00:00Z'), refreshedAt: NOW } })
    // hanya 4 digit akhir yang disimpan
    expect(JSON.stringify(up)).not.toContain('447700900123')
    expect(up[1]).toMatchObject({ create: { phoneTail: null, conversationId: null } })
    expect(mockPrisma.agentSchedule.deleteMany.mock.calls[0][0]).toMatchObject({
      where: { sendAt: { gte: new Date('2026-11-23T17:00:00Z') }, key: { notIn: ['trip_information:1', 'payment_reminder:4'] } },
    })
  })

  it('endpoint belum ada (404) atau jawaban rusak: salinan lama dibiarkan', async () => {
    stub(404, { error: 'not found' })
    expect(await syncAgentSchedule(NOW)).toEqual({ status: 'unavailable', code: 404 })
    stub(200, { items: [{ key: 'x' }] })
    expect(await syncAgentSchedule(NOW)).toEqual({ status: 'unavailable', code: 200 })
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })

  it('tanpa BOOKING_API_URL/KEY: tidak memanggil apa pun; jaringan gagal tidak melempar', async () => {
    delete process.env.BOOKING_API_KEY
    const fn = stub(200, { items: [] })
    expect(await syncAgentSchedule(NOW)).toEqual({ status: 'not_configured' })
    expect(fn).not.toHaveBeenCalled()
    process.env.BOOKING_API_KEY = 'k'
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNRESET') }))
    expect(await syncAgentSchedule(NOW)).toEqual({ status: 'unavailable', code: null })
  })
})

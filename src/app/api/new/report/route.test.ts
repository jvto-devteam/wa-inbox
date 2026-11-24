import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/get-session', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/db', () => ({ prisma: { $queryRaw: vi.fn() } }))

import { getSession } from '@/lib/auth/get-session'
import { prisma } from '@/lib/db'
import { GET } from './route'

const req = (q: string) => new Request('http://localhost/api/new/report' + q)

beforeEach(() => {
  vi.mocked(getSession).mockResolvedValue({ accountId: 'a1', role: 'AGENT' } as never)
  vi.mocked(prisma.$queryRaw).mockReset()
})

describe('GET /api/new/report', () => {
  it('401 tanpa sesi', async () => {
    vi.mocked(getSession).mockResolvedValue(null as never)
    expect((await GET(req('?from=2026-11-23&to=2026-11-29'))).status).toBe(401)
  })

  it('400 untuk tanggal tidak valid', async () => {
    expect((await GET(req('?from=23-11-2026&to=2026-11-29'))).status).toBe(400)
    expect((await GET(req('?from=2026-11-30&to=2026-11-29'))).status).toBe(400)
    expect(prisma.$queryRaw).not.toHaveBeenCalled()
  })

  it('membangun laporan dari baris kueri', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      { id: 'c1', name: 'Tamu', phone: '447700900123', stage: 'booked', first_in: new Date('2026-11-23T03:00:00Z'), booking_date: '24 Nov 2026', booking_number: 'JVTO-9', package: '3D Bromo', start_ymd: '2026-12-10', order_channel: 'JVTO', kind: 'calon_tamu' },
    ] as never)
    const res = await GET(req('?from=2026-11-23&to=2026-11-29'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ inquiries: 1, inquiriesBooked: 1 })
    expect(body.bookings[0]).toMatchObject({ conversationId: 'c1', bookingNumber: 'JVTO-9', phoneTail: '••• 0123' })
    expect(JSON.stringify(body)).not.toContain('447700900123')
  })

  it('500 tanpa membocorkan galat', async () => {
    vi.mocked(prisma.$queryRaw).mockRejectedValue(new Error('koneksi postgres://rahasia'))
    const res = await GET(req('?from=2026-11-23&to=2026-11-29'))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Gagal membuat laporan' })
  })
})

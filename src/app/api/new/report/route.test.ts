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
      { id: 'c1', name: 'Tamu', phone: '447700900123', stage: 'booked', first_in: new Date('2026-11-23T03:00:00Z'), booking_date: '24 Nov 2026', booking_number: 'JVTO-9', package: '3D Bromo', start_ymd: '2026-12-10', order_channel: 'JVTO', kind: 'calon_tamu', blocker: null, next_step: null, review_at: null, last_at: null, last_dir: null },
      { id: 'c2', name: 'Lead', phone: '447700900999', stage: 'new', first_in: new Date('2026-11-24T03:00:00Z'), booking_date: null, booking_number: null, package: null, start_ymd: null, order_channel: null, kind: 'calon_tamu', blocker: { alasan: 'belum_pasti', teks: 'Menunggu cuti', rekomendasi: 'Tanya lagi Jumat' }, next_step: '', review_at: new Date('2026-11-24T04:00:00Z'), last_at: new Date('2026-11-24T03:30:00Z'), last_dir: 'OUTBOUND' },
    ] as never)
    const res = await GET(req('?from=2026-11-23&to=2026-11-29'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ inquiries: 2, inquiriesBooked: 1 })
    expect(body.leads).toHaveLength(1)
    expect(body.leads[0]).toMatchObject({ conversationId: 'c2', alasan: 'belum_pasti', rekomendasi: 'Tanya lagi Jumat', sumber: 'ai' })
    expect(body.blockers).toEqual([{ alasan: 'belum_pasti', label: 'Tanggal atau rencana belum pasti', count: 1 }])
    expect(body.bookings[0]).toMatchObject({ conversationId: 'c1', bookingNumber: 'JVTO-9', phoneTail: '••• 0123' })
    expect(JSON.stringify(body)).not.toContain('447700900123')
    expect(JSON.stringify(body)).not.toContain('447700900999')
  })

  it('AL-03/AL-05: tanggal trip dari ringkasan (tahun dibetulkan) dan item Balas terbuka ikut ke laporan', async () => {
    const lead = { id: 'c3', contact_id: 'k3', name: 'Lead', phone: '447700900555', stage: 'new', first_in: new Date('2026-11-12T03:00:00Z'), booking_date: null, booking_number: null, package: null, start_ymd: null, order_channel: null, kind: 'calon_tamu', blocker: { alasan: 'menunggu_tim', teks: 'Link DP', rekomendasi: 'Kirim' }, next_step: null, review_at: null, last_at: null, last_dir: null, created_at: new Date('2026-11-12T03:00:00Z'), profile: null, awaiting_guest: null }
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      // AI menulis 2025, percakapan dimulai Nov 2026 -> 2026-11-19
      { ...lead, trip_start: '2025-11-19', trip_end: null, awaiting_reply: false },
      { ...lead, id: 'c4', trip_start: null, trip_end: null, awaiting_reply: true },
    ] as never)
    const body = await (await GET(req('?from=2026-11-01&to=2026-11-30'))).json()
    expect(body.leads.find((l: { conversationId: string }) => l.conversationId === 'c3')).toMatchObject({ tripPassed: true, lostByUs: true, waitingUs: false })
    expect(body.leads.find((l: { conversationId: string }) => l.conversationId === 'c4')).toMatchObject({ tripPassed: false, waitingUs: true })
  })

  it('500 tanpa membocorkan galat', async () => {
    vi.mocked(prisma.$queryRaw).mockRejectedValue(new Error('koneksi postgres://rahasia'))
    const res = await GET(req('?from=2026-11-23&to=2026-11-29'))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Gagal membuat laporan' })
  })
})

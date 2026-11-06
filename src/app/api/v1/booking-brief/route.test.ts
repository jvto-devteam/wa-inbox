/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { authenticateApiClient } from '@/lib/api-clients/auth'
import { GET } from './route'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/api-clients/auth', () => ({ authenticateApiClient: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

function note(overrides: Record<string, string[]> = {}) {
  return {
    diperbaruiAt: '2026-11-06T03:00:00.000Z',
    perubahan: [],
    waktuKritis: [],
    siapa: [],
    karakter: [],
    kebutuhan: [],
    permintaan: [],
    logistik: [],
    janjiTim: [],
    jangan: [],
    ...overrides,
  }
}

const get = (query = '?ref=JVR%2F012%2F11%2F26', key = 'wai_crew') =>
  GET(new Request(`http://x/api/v1/booking-brief${query}`, { headers: { authorization: `Bearer ${key}` } }))

beforeEach(() => {
  mockReset(mockPrisma)
  vi.clearAllMocks()
  process.env.BOOKING_BRIEF_READ_CLIENT_IDS = 'client_crew, client_other'
  vi.mocked(authenticateApiClient).mockResolvedValue({ id: 'client_crew', name: 'crew-portal' })
  mockPrisma.conversation.findMany.mockResolvedValue([
    { chatReview: { catatanCrew: note({ perubahan: ['Jemput tour 20 Nov jam 11:00, bukan 08:00.'], logistik: ['6 kamar: 4 twin dan 2 double.'] }) }, chatReviewAt: new Date() },
  ] as never)
})

afterEach(() => {
  delete process.env.BOOKING_BRIEF_READ_CLIENT_IDS
})

describe('GET /api/v1/booking-brief', () => {
  it('menolak permintaan tanpa key yang sah', async () => {
    vi.mocked(authenticateApiClient).mockResolvedValue(null)
    expect((await get()).status).toBe(401)
    expect(mockPrisma.conversation.findMany).not.toHaveBeenCalled()
  })

  it('menolak key sah yang tidak ada di daftar baca (key pengirim pesan, key Operator)', async () => {
    vi.mocked(authenticateApiClient).mockResolvedValue({ id: 'client_sender', name: 'legacy' })
    expect((await get()).status).toBe(403)
    expect(mockPrisma.conversation.findMany).not.toHaveBeenCalled()
  })

  it('tertutup untuk semua key bila daftar baca kosong', async () => {
    delete process.env.BOOKING_BRIEF_READ_CLIENT_IDS
    expect((await get()).status).toBe(403)
  })

  it.each(['', '?ref=', '?ref=ab', '?ref=' + 'x'.repeat(65), '?ref=JVR%3Bdrop%20table', '?ref=%7B%22a%22%3A1%7D'])('400 untuk ref tidak sah (%s)', async (q) => {
    expect((await get(q)).status).toBe(400)
    expect(mockPrisma.conversation.findMany).not.toHaveBeenCalled()
  })

  it('mengembalikan hanya bagian yang berisi, berurutan, tanpa cache', async () => {
    const res = await get()
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(await res.json()).toEqual({
      ref: 'JVR/012/11/26',
      diperbaruiAt: '2026-11-06T03:00:00.000Z',
      bagian: [
        { kunci: 'perubahan', baris: ['Jemput tour 20 Nov jam 11:00, bukan 08:00.'] },
        { kunci: 'logistik', baris: ['6 kamar: 4 twin dan 2 double.'] },
      ],
    })
  })

  it('mencari lewat booking_number ATAU id pada bookingData, ringkasan terbaru dulu', async () => {
    await get()
    const arg = mockPrisma.conversation.findMany.mock.calls[0][0]!
    expect(arg.where?.OR).toEqual([
      { bookingData: { path: ['booking_number'], equals: 'JVR/012/11/26' } },
      { bookingData: { path: ['id'], equals: 'JVR/012/11/26' } },
    ])
    expect(arg.orderBy).toEqual({ chatReviewAt: 'desc' })
  })

  it('menyaring ulang isi: nominal, kata bayar, telepon, dan email tidak pernah keluar', async () => {
    mockPrisma.conversation.findMany.mockResolvedValue([
      {
        chatReview: {
          catatanCrew: note({
            permintaan: ['Tamu menimbang permit drone (Rp2jt).', 'Tamu membawa drone kecil.'],
            logistik: ['Sisa dibayar tunai.', 'Hubungi 0812 3456 7890.', 'Kirim ke a@b.com.', 'Jemput di lobi.'],
          }),
        },
        chatReviewAt: new Date(),
      },
    ] as never)
    const body = await (await get()).json()
    expect(body.bagian).toEqual([
      { kunci: 'permintaan', baris: ['Tamu membawa drone kecil.'] },
      { kunci: 'logistik', baris: ['Jemput di lobi.'] },
    ])
  })

  it('melewati percakapan tanpa catatan dan memakai yang berikutnya', async () => {
    mockPrisma.conversation.findMany.mockResolvedValue([
      { chatReview: { status: 'selesai' }, chatReviewAt: new Date() },
      { chatReview: { catatanCrew: note({ siapa: ['Pasangan.'] }) }, chatReviewAt: new Date() },
    ] as never)
    const body = await (await get()).json()
    expect(body.bagian).toEqual([{ kunci: 'siapa', baris: ['Pasangan.'] }])
  })

  it('404 bila tidak ada percakapan, tidak ada catatan, atau catatan kosong', async () => {
    mockPrisma.conversation.findMany.mockResolvedValue([] as never)
    expect((await get()).status).toBe(404)
    mockPrisma.conversation.findMany.mockResolvedValue([{ chatReview: { catatanCrew: note() }, chatReviewAt: new Date() }] as never)
    expect((await get()).status).toBe(404)
  })

  it('500 tanpa membocorkan galat bila database gagal', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockPrisma.conversation.findMany.mockRejectedValue(new Error('db mati: password=abc'))
    const res = await get()
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('password')
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'
import { GET } from './route'

// `vi.mock` factories are hoisted above regular imports and `let`/`const`
// declarations, so the mock instance must be constructed inline inside the
// factory (referencing only the already-imported `mockDeep` and the erased
// `PrismaClient` type) rather than via an outer variable — otherwise the
// factory throws "Cannot access ... before initialization".
vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))

// Route ini sebelumnya tidak punya cek auth sama sekali. Sekarang butuh sesi, jadi setiap
// test harus punya satu -- kecuali test yang justru menguji penolakannya.
vi.mock('@/lib/auth/get-session', () => ({ getSession: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

beforeEach(() => {
  mockReset(mockPrisma)
  vi.mocked(getSession).mockResolvedValue({ sub: 'acc_1', role: 'AGENT' } as never)
  // Sejak Task 9 route ini membaca dua tabel (lihat komentar di route.ts): kontak tanpa
  // percakapan (tier 1, dari `contact`) dan kontak dengan percakapan (tier 2, dari
  // `conversation`, diurut langsung oleh `lastMessageAt` -- Prisma tidak lagi bisa
  // mengurutkan Contact lewat field anak relasinya sekarang Contact bisa punya banyak
  // Conversation). Default: tidak ada baris sama sekali di kedua tier, supaya `total` dan
  // `rows` tidak pernah `undefined` di test yang tidak peduli soal isinya.
  mockPrisma.conversation.count.mockResolvedValue(0 as never)
  mockPrisma.contact.count.mockResolvedValue(0 as never)
  mockPrisma.contact.findMany.mockResolvedValue([] as never)
  mockPrisma.conversation.findMany.mockResolvedValue([] as never)
})

describe('GET /api/contacts', () => {
  it('lists contacts with their conversation pipeline stage and labels', async () => {
    mockPrisma.conversation.count.mockResolvedValue(1 as never)
    mockPrisma.conversation.findMany.mockResolvedValue([
      {
        id: 'conv_1',
        pipelineStage: 'nego',
        orderChannel: null,
        lastMessageAt: new Date('2026-07-20T10:00:00Z'),
        contact: { id: 'contact_1', name: 'Bruno', phone: '6281234567890' },
        labels: [{ label: { name: 'Confirmed Booking' } }],
      },
    ] as never)

    const res = await GET(new Request('http://localhost/api/contacts'))
    const body = await res.json()

    expect(body.rows[0]).toEqual(
      expect.objectContaining({ name: 'Bruno', pipelineStage: 'nego', labels: ['Confirmed Booking'] }),
    )
  })

  it('handles a contact with no conversation yet without crashing', async () => {
    // Kontak yang lahir dari template sistem ke nomor internal (lihat komentar `conversationId`
    // di schema.prisma) tidak pernah punya Conversation -- tier 1 route.ts.
    mockPrisma.contact.count.mockResolvedValue(1 as never)
    mockPrisma.contact.findMany.mockResolvedValue([
      { id: 'contact_2', name: null, phone: '6289999999999' },
    ] as never)

    const res = await GET(new Request('http://localhost/api/contacts'))
    const body = await res.json()

    expect(body.rows[0]).toEqual(
      expect.objectContaining({ pipelineStage: 'new', lastContactAt: null, labels: [] }),
    )
  })

  it('filters by ?stage=', async () => {
    await GET(new Request('http://localhost/api/contacts?stage=nego'))

    // Filter stage hidup di Conversation, jadi tier 1 (kontak tanpa percakapan) tidak pernah
    // ikut diquery saat stage aktif -- filter itu tidak pernah bisa cocok untuk mereka.
    expect(mockPrisma.contact.findMany).not.toHaveBeenCalled()
    expect(mockPrisma.conversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ pipelineStage: 'nego' }),
      }),
    )
  })

  it('filters by ?labelId= to only contacts whose conversation has that label attached', async () => {
    mockPrisma.conversation.count.mockResolvedValue(1 as never)
    mockPrisma.conversation.findMany.mockResolvedValue([
      {
        id: 'conv_1',
        pipelineStage: 'nego',
        orderChannel: null,
        lastMessageAt: new Date('2026-07-20T10:00:00Z'),
        contact: { id: 'contact_1', name: 'Bruno', phone: '6281234567890' },
        labels: [{ label: { name: 'Confirmed Booking' } }],
      },
    ] as never)

    const res = await GET(new Request('http://localhost/api/contacts?labelId=lbl_1'))
    const body = await res.json()

    expect(mockPrisma.conversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ labels: { some: { labelId: 'lbl_1' } } }),
      }),
    )
    expect(body.rows[0]).toEqual(expect.objectContaining({ name: 'Bruno', labels: ['Confirmed Booking'] }))
  })

  it('does not return contacts without a matching label when ?labelId= is set', async () => {
    // The DB-level filter is what actually excludes non-matching contacts; here we assert the
    // route trusts prisma's where clause rather than re-filtering in memory (which would require
    // labels on the conversation to be present regardless of the query).
    const res = await GET(new Request('http://localhost/api/contacts?labelId=lbl_missing'))
    const body = await res.json()

    expect(body.rows).toEqual([])
  })
})

describe('GET /api/contacts — pagination lintas tier (Temuan I-3, fix round 1)', () => {
  // route.ts membaca dua tabel karena Prisma tidak bisa lagi mengurutkan Contact lewat field
  // anak relasi ke-banyak (lihat komentar panjang di route.ts). Aritmetika `skip`/`take` yang
  // membagi satu halaman lintas tier 1 (kontak tanpa percakapan) dan tier 2 (kontak dengan
  // percakapan) sudah diverifikasi manual sekali oleh reviewer -- CLAUDE.md §9 menyatakan tegas
  // bahwa pembacaan manual bukan pemeriksa yang sah. Test ini adalah pemeriksa yang BISA gagal:
  // ia mensimulasikan Postgres sungguhan (skip/take diterapkan ke array tetap, bukan dijawab
  // dengan mockResolvedValue statis) untuk dataset kecil dengan N1 = 3 kontak tier 1 dan
  // N2 = 3 kontak tier 2, lalu membuktikan urutan gabungan yang route.ts JANJIKAN (tier 1 dulu,
  // lalu tier 2) utuh lintas beberapa halaman: nol baris hilang, nol baris muncul dua kali.
  //
  // Urutan gabungan yang benar, dalam urutan yang seharusnya dikembalikan: c1, c2, c3 (tier 1,
  // createdAt desc) lalu v1, v2, v3 (tier 2, lastMessageAt desc). rowKey() membaca
  // `conversationId` kalau ada (baris tier 2, unik per percakapan) atau `id` (baris tier 1).
  const tier1Data = [
    { id: 'c1', name: 'C1', phone: null },
    { id: 'c2', name: 'C2', phone: null },
    { id: 'c3', name: 'C3', phone: null },
  ]
  const tier2Data = [
    {
      id: 'v1',
      pipelineStage: 'new',
      orderChannel: null,
      lastMessageAt: new Date('2026-01-03T00:00:00Z'),
      contact: { id: 'k1', name: 'V1', phone: '628100000001' },
      labels: [],
    },
    {
      id: 'v2',
      pipelineStage: 'new',
      orderChannel: null,
      lastMessageAt: new Date('2026-01-02T00:00:00Z'),
      contact: { id: 'k2', name: 'V2', phone: '628100000002' },
      labels: [],
    },
    {
      id: 'v3',
      pipelineStage: 'new',
      orderChannel: null,
      lastMessageAt: new Date('2026-01-01T00:00:00Z'),
      contact: { id: 'k3', name: 'V3', phone: '628100000003' },
      labels: [],
    },
  ]
  const rowKey = (r: { id: string; conversationId: string | null }) => r.conversationId ?? r.id

  beforeEach(() => {
    mockPrisma.contact.count.mockResolvedValue(tier1Data.length as never)
    mockPrisma.conversation.count.mockResolvedValue(tier2Data.length as never)
    // Implementasi PALSU tapi SUNGGUHAN dari skip/take -- bukan mockResolvedValue tetap. Kalau
    // route.ts salah menghitung remainingSkip/remainingTake, ini akan mengiris array yang salah
    // dan test di bawah akan gagal, persis seperti query nyata terhadap Postgres akan berbeda.
    mockPrisma.contact.findMany.mockImplementation(((args: { skip?: number; take?: number }) => {
      const skip = args.skip ?? 0
      const take = args.take ?? tier1Data.length
      return Promise.resolve(tier1Data.slice(skip, skip + take))
    }) as never)
    mockPrisma.conversation.findMany.mockImplementation(((args: { skip?: number; take?: number }) => {
      const skip = args.skip ?? 0
      const take = args.take ?? tier2Data.length
      return Promise.resolve(tier2Data.slice(skip, skip + take))
    }) as never)
  })

  it('kasus 1: skip jatuh DI DALAM tier 1 (page 1, limit 2) -- dua baris pertama tier 1', async () => {
    const res = await GET(new Request('http://localhost/api/contacts?limit=2&page=1'))
    const body = await res.json()

    expect(body.rows.map(rowKey)).toEqual(['c1', 'c2'])
    expect(body.total).toBe(6)
  })

  it('kasus 2: skip TEPAT di batas tier (skip === N1 === 3) -- baris pertama tier 2, bukan tier 1 lagi', async () => {
    // page=4, limit=1 -> skip = (4-1)*1 = 3, persis N1.
    const res = await GET(new Request('http://localhost/api/contacts?limit=1&page=4'))
    const body = await res.json()

    expect(body.rows.map(rowKey)).toEqual(['v1'])
    expect(body.total).toBe(6)
  })

  it('kasus 3: skip jatuh DI DALAM tier 2 (skip=4, limit=2) -- dua baris terakhir tier 2', async () => {
    // page=3, limit=2 -> skip = (3-1)*2 = 4.
    const res = await GET(new Request('http://localhost/api/contacts?limit=2&page=3'))
    const body = await res.json()

    expect(body.rows.map(rowKey)).toEqual(['v2', 'v3'])
    expect(body.total).toBe(6)
  })

  it('kasus 4: satu halaman memuat EKOR tier 1 DAN KEPALA tier 2 sekaligus (skip=2, limit=2)', async () => {
    // page=2, limit=2 -> skip = (2-1)*2 = 2. Tier 1 hanya punya 1 baris tersisa (c3) di posisi
    // itu, jadi sisa jatah halaman (1 baris) harus diisi dari AWAL tier 2 (v1) -- bukan
    // meloncat atau mengulang.
    const res = await GET(new Request('http://localhost/api/contacts?limit=2&page=2'))
    const body = await res.json()

    expect(body.rows.map(rowKey)).toEqual(['c3', 'v1'])
    expect(body.total).toBe(6)
  })

  it('menyapu semua halaman (limit=2, page 1..3) merekonstruksi urutan gabungan PERSIS SEKALI -- nol hilang, nol dobel', async () => {
    const seen: string[] = []
    for (const page of [1, 2, 3]) {
      const res = await GET(new Request(`http://localhost/api/contacts?limit=2&page=${page}`))
      const body = await res.json()
      seen.push(...body.rows.map(rowKey))
      expect(body.total).toBe(6)
    }

    expect(seen).toEqual(['c1', 'c2', 'c3', 'v1', 'v2', 'v3'])
  })
})

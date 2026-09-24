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

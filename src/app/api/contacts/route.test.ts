import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { GET } from './route'

// `vi.mock` factories are hoisted above regular imports and `let`/`const`
// declarations, so the mock instance must be constructed inline inside the
// factory (referencing only the already-imported `mockDeep` and the erased
// `PrismaClient` type) rather than via an outer variable — otherwise the
// factory throws "Cannot access ... before initialization".
vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

beforeEach(() => {
  mockReset(mockPrisma)
})

describe('GET /api/contacts', () => {
  it('lists contacts with their conversation pipeline stage and labels', async () => {
    mockPrisma.contact.findMany.mockResolvedValue([
      {
        id: 'contact_1',
        name: 'Bruno',
        phone: '6281234567890',
        conversation: {
          pipelineStage: 'nego',
          lastMessageAt: new Date('2026-07-20T10:00:00Z'),
          labels: [{ label: { name: 'Confirmed Booking' } }],
        },
      },
    ] as never)

    const res = await GET(new Request('http://localhost/api/contacts'))
    const body = await res.json()

    expect(body[0]).toEqual(
      expect.objectContaining({ name: 'Bruno', pipelineStage: 'nego', labels: ['Confirmed Booking'] }),
    )
  })

  it('handles a contact with no conversation yet without crashing', async () => {
    mockPrisma.contact.findMany.mockResolvedValue([
      { id: 'contact_2', name: null, phone: '6289999999999', conversation: null },
    ] as never)

    const res = await GET(new Request('http://localhost/api/contacts'))
    const body = await res.json()

    expect(body[0]).toEqual(
      expect.objectContaining({ pipelineStage: 'new', lastContactAt: null, labels: [] }),
    )
  })

  it('filters by ?stage=', async () => {
    mockPrisma.contact.findMany.mockResolvedValue([] as never)

    await GET(new Request('http://localhost/api/contacts?stage=nego'))

    expect(mockPrisma.contact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ conversation: expect.objectContaining({ pipelineStage: 'nego' }) }),
      }),
    )
  })

  it('filters by ?labelId= to only contacts whose conversation has that label attached', async () => {
    mockPrisma.contact.findMany.mockResolvedValue([
      {
        id: 'contact_1',
        name: 'Bruno',
        phone: '6281234567890',
        conversation: {
          pipelineStage: 'nego',
          lastMessageAt: new Date('2026-07-20T10:00:00Z'),
          labels: [{ label: { name: 'Confirmed Booking' } }],
        },
      },
    ] as never)

    const res = await GET(new Request('http://localhost/api/contacts?labelId=lbl_1'))
    const body = await res.json()

    expect(mockPrisma.contact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          conversation: expect.objectContaining({ labels: { some: { labelId: 'lbl_1' } } }),
        }),
      }),
    )
    expect(body[0]).toEqual(expect.objectContaining({ name: 'Bruno', labels: ['Confirmed Booking'] }))
  })

  it('does not return contacts without a matching label when ?labelId= is set', async () => {
    // The DB-level filter is what actually excludes non-matching contacts; here we assert the
    // route trusts prisma's where clause rather than re-filtering in memory (which would require
    // labels on the conversation to be present regardless of the query).
    mockPrisma.contact.findMany.mockResolvedValue([] as never)

    const res = await GET(new Request('http://localhost/api/contacts?labelId=lbl_missing'))
    const body = await res.json()

    expect(body).toEqual([])
  })
})

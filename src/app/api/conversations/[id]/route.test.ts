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

describe('GET /api/conversations/[id]', () => {
  it('returns the conversation botEnabled flag plus contact and booking/trip-brief info', async () => {
    mockPrisma.conversation.findUniqueOrThrow.mockResolvedValue({
      botEnabled: true,
      bookingData: { destination: 'Bromo', dateRange: '10-12 Aug', pax: 2, amountPaid: 500000, amountDue: 500000, status: 'CONFIRMED' },
      tripBrief: null,
      contact: { name: 'Bruno Figarola', avatarUrl: 'https://example.com/a.jpg', source: 'Instagram' },
      labels: [{ label: { id: 'lbl_1', name: 'Confirmed Booking', color: '#3C6B42' } }],
    } as never)

    const res = await GET(new Request('http://localhost/api/conversations/conv_1'), { params: Promise.resolve({ id: 'conv_1' }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({
      botEnabled: true,
      contactName: 'Bruno Figarola',
      avatarUrl: 'https://example.com/a.jpg',
      source: 'Instagram',
      bookingData: { destination: 'Bromo', dateRange: '10-12 Aug', pax: 2, amountPaid: 500000, amountDue: 500000, status: 'CONFIRMED' },
      tripBrief: null,
      labels: [{ id: 'lbl_1', name: 'Confirmed Booking', color: '#3C6B42' }],
    })
    expect(mockPrisma.conversation.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: 'conv_1' },
      include: { contact: true, labels: { include: { label: true } } },
    })
  })

  it('reflects botEnabled false when the bot has been taken over', async () => {
    mockPrisma.conversation.findUniqueOrThrow.mockResolvedValue({
      botEnabled: false,
      bookingData: null,
      tripBrief: null,
      contact: { name: null, avatarUrl: null, source: null },
      labels: [],
    } as never)

    const res = await GET(new Request('http://localhost/api/conversations/conv_1'), { params: Promise.resolve({ id: 'conv_1' }) })

    expect((await res.json()).botEnabled).toBe(false)
  })

  it('returns tripBrief fields when no bookingData exists yet (funnel-only lead)', async () => {
    mockPrisma.conversation.findUniqueOrThrow.mockResolvedValue({
      botEnabled: true,
      bookingData: null,
      tripBrief: { destination: 'Bali', pax: 4 },
      contact: { name: 'Ayu', avatarUrl: null, source: 'WhatsApp Ads' },
      labels: [],
    } as never)

    const res = await GET(new Request('http://localhost/api/conversations/conv_1'), { params: Promise.resolve({ id: 'conv_1' }) })
    const body = await res.json()

    expect(body.bookingData).toBeNull()
    expect(body.tripBrief).toEqual({ destination: 'Bali', pax: 4 })
  })

  it('returns both bookingData and tripBrief as null for a brand-new conversation with no funnel data', async () => {
    mockPrisma.conversation.findUniqueOrThrow.mockResolvedValue({
      botEnabled: true,
      bookingData: null,
      tripBrief: null,
      contact: { name: null, avatarUrl: null, source: null },
      labels: [],
    } as never)

    const res = await GET(new Request('http://localhost/api/conversations/conv_1'), { params: Promise.resolve({ id: 'conv_1' }) })
    const body = await res.json()

    expect(body.bookingData).toBeNull()
    expect(body.tripBrief).toBeNull()
  })
})

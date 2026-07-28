import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { ensureFreshBookingData } from '@/lib/booking/client'
import { GET } from './route'

// `vi.mock` factories are hoisted above regular imports and `let`/`const`
// declarations, so the mock instance must be constructed inline inside the
// factory (referencing only the already-imported `mockDeep` and the erased
// `PrismaClient` type) rather than via an outer variable — otherwise the
// factory throws "Cannot access ... before initialization".
vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/booking/client', () => ({ ensureFreshBookingData: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

beforeEach(() => {
  mockReset(mockPrisma)
  vi.mocked(ensureFreshBookingData).mockReset()
})

describe('GET /api/conversations/[id]', () => {
  it('returns the conversation botEnabled flag plus contact and booking/trip-brief info', async () => {
    mockPrisma.conversation.findUniqueOrThrow.mockResolvedValue({
      botEnabled: true,
      bookingData: { destination: 'Bromo', dateRange: '10-12 Aug', pax: 2, amountPaid: 500000, amountDue: 500000, status: 'CONFIRMED' },
      tripBrief: null,
      contact: { id: 'contact_1', name: 'Bruno Figarola', avatarUrl: 'https://example.com/a.jpg', source: 'Instagram' },
      labels: [{ label: { id: 'lbl_1', name: 'Confirmed Booking', color: '#3C6B42' } }],
      pipelineStage: 'booked',
      assignedAgentId: 'acc_1',
    } as never)
    vi.mocked(ensureFreshBookingData).mockResolvedValue({
      destination: 'Bromo', dateRange: '10-12 Aug', pax: 2, amountPaid: 500000, amountDue: 500000, status: 'CONFIRMED',
    } as never)

    const res = await GET(new Request('http://localhost/api/conversations/conv_1'), { params: Promise.resolve({ id: 'conv_1' }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({
      botEnabled: true,
      contactId: 'contact_1',
      contactName: 'Bruno Figarola',
      avatarUrl: 'https://example.com/a.jpg',
      source: 'Instagram',
      bookingData: { destination: 'Bromo', dateRange: '10-12 Aug', pax: 2, amountPaid: 500000, amountDue: 500000, status: 'CONFIRMED' },
      tripBrief: null,
      labels: [{ id: 'lbl_1', name: 'Confirmed Booking', color: '#3C6B42' }],
      pipelineStage: 'booked',
      assignedAgentId: 'acc_1',
      lastReadAt: null,
    })
    expect(mockPrisma.conversation.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: 'conv_1' },
      include: { contact: true, labels: { include: { label: true } } },
    })
  })

  it('refreshes booking data via ensureFreshBookingData rather than trusting the stale conversation row directly', async () => {
    // Regression guard: the route used to read conversation.bookingData straight off the
    // Prisma row, which only ever got populated as a side effect of the bot answering a
    // message. ContactPanel must show real booking data on open even when the bot never ran
    // for this conversation (e.g. the kill switch is on).
    const conversationRow = {
      id: 'conv_1',
      botEnabled: true,
      bookingData: null, // stale/never-fetched in the DB row
      bookingCheckedAt: null,
      tripBrief: null,
      contact: { id: 'contact_1', name: 'Bruno', avatarUrl: null, source: null, phone: '6281234567890' },
      labels: [],
      pipelineStage: 'new',
      assignedAgentId: null,
    }
    mockPrisma.conversation.findUniqueOrThrow.mockResolvedValue(conversationRow as never)
    vi.mocked(ensureFreshBookingData).mockResolvedValue({ id: 'B1', guest: 'Bruno' } as never)

    const res = await GET(new Request('http://localhost/api/conversations/conv_1'), { params: Promise.resolve({ id: 'conv_1' }) })
    const body = await res.json()

    expect(ensureFreshBookingData).toHaveBeenCalledWith(conversationRow)
    expect(body.bookingData).toEqual({ id: 'B1', guest: 'Bruno' })
  })

  it('reflects botEnabled false when the bot has been taken over', async () => {
    mockPrisma.conversation.findUniqueOrThrow.mockResolvedValue({
      botEnabled: false,
      bookingData: null,
      tripBrief: null,
      contact: { name: null, avatarUrl: null, source: null },
      labels: [],
      pipelineStage: 'new',
      assignedAgentId: null,
    } as never)
    vi.mocked(ensureFreshBookingData).mockResolvedValue(null)

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
      pipelineStage: 'new',
      assignedAgentId: null,
    } as never)
    vi.mocked(ensureFreshBookingData).mockResolvedValue(null)

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
      pipelineStage: 'new',
      assignedAgentId: null,
    } as never)
    vi.mocked(ensureFreshBookingData).mockResolvedValue(null)

    const res = await GET(new Request('http://localhost/api/conversations/conv_1'), { params: Promise.resolve({ id: 'conv_1' }) })
    const body = await res.json()

    expect(body.bookingData).toBeNull()
    expect(body.tripBrief).toBeNull()
  })
})

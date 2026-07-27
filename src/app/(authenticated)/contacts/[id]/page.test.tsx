import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import ContactDetailPage from './page'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

// The nested client components (labels, notes, reminders) each fetch on mount and are
// covered by their own tests; they are stubbed here so this file tests only what the
// page itself renders.
vi.mock('@/components/contacts/ContactLabels', () => ({ ContactLabels: () => <div /> }))
vi.mock('@/components/inbox/NotesSection', () => ({ NotesSection: () => <div /> }))
vi.mock('@/components/inbox/RemindersSection', () => ({ RemindersSection: () => <div /> }))

function contactWith(messages: Array<Record<string, unknown>>) {
  return {
    id: 'contact_1',
    name: 'Bruno Figarola',
    phone: '6281234567890',
    avatarUrl: null,
    source: null,
    conversation: {
      id: 'conv_1',
      pipelineStage: 'new',
      bookingData: null,
      tripBrief: null,
      labels: [],
      messages,
    },
  }
}

beforeEach(() => {
  mockReset(mockPrisma)
  mockPrisma.label.findMany.mockResolvedValue([] as never)
})

afterEach(cleanup)

describe('contacts/[id] message history', () => {
  // Regression: this page rendered `m.content ?? `[${m.type}]`` for every row. A bot
  // handoff is a log-only Message row (content: null, sentBy: 'BOT') that was never sent
  // to the customer — showing "[text]" told whoever reads the contact's history that the
  // bot sent a text message. MessageBubble and ConversationListItem already got this right.
  it('renders the handoff placeholder for a logged bot handoff, not "[text]"', async () => {
    mockPrisma.contact.findUnique.mockResolvedValue(
      contactWith([
        {
          id: 'm1',
          content: null,
          type: 'text',
          sentBy: 'BOT',
          direction: 'OUTBOUND',
          createdAt: new Date('2026-07-20T03:00:00Z'),
        },
      ]) as never
    )

    render(await ContactDetailPage({ params: Promise.resolve({ id: 'contact_1' }) }))

    expect(screen.getByText('Bot menyerahkan ke agen — lihat alasan')).toBeInTheDocument()
    expect(screen.queryByText('[text]')).not.toBeInTheDocument()
  })

  it('renders ordinary message content unchanged', async () => {
    mockPrisma.contact.findUnique.mockResolvedValue(
      contactWith([
        {
          id: 'm1',
          content: 'Halo, mau tanya paket Ijen',
          type: 'text',
          sentBy: 'CUSTOMER',
          direction: 'INBOUND',
          createdAt: new Date('2026-07-20T03:00:00Z'),
        },
      ]) as never
    )

    render(await ContactDetailPage({ params: Promise.resolve({ id: 'contact_1' }) }))

    expect(screen.getByText('Halo, mau tanya paket Ijen')).toBeInTheDocument()
    expect(screen.getByText(/Masuk/)).toBeInTheDocument()
  })

  // A content-less message that is NOT a bot handoff (an image, say) still needs its
  // type marker — the fix must not swallow that case.
  it('still shows the [type] marker for a content-less customer message', async () => {
    mockPrisma.contact.findUnique.mockResolvedValue(
      contactWith([
        {
          id: 'm1',
          content: null,
          type: 'image',
          sentBy: 'CUSTOMER',
          direction: 'INBOUND',
          createdAt: new Date('2026-07-20T03:00:00Z'),
        },
      ]) as never
    )

    render(await ContactDetailPage({ params: Promise.resolve({ id: 'contact_1' }) }))

    expect(screen.getByText('[image]')).toBeInTheDocument()
  })
})

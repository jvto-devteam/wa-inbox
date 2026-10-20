/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/daily-summary/review', () => ({ reviewConversation: vi.fn() }))
vi.mock('@/lib/summary-items/sync', () => ({ applyReviewToItem: vi.fn().mockResolvedValue('unchanged') }))
vi.mock('./store', () => ({ saveChatReview: vi.fn().mockResolvedValue(undefined) }))

import { prisma } from '@/lib/db'
import { reviewConversation } from '@/lib/daily-summary/review'
import { refreshChatReview } from './refresh'

const db = prisma as unknown as DeepMockProxy<PrismaClient>
const NOW = new Date('2026-10-20T05:00:00Z')
const question = { id: 'm1', direction: 'INBOUND', sentBy: 'CUSTOMER', type: 'text', content: 'ganti kaos jadi L, dan bisa tambah Ijen?', createdAt: new Date('2026-10-20T03:00:00Z') }
const notice = { id: 'n1', direction: 'OUTBOUND', sentBy: 'BOT', type: 'text', content: 'Noted, thank you! Your booking has been updated:', createdAt: new Date('2026-10-20T03:00:10Z') }

beforeEach(() => {
  mockReset(db)
  vi.mocked(reviewConversation).mockReset().mockResolvedValue(null)
  db.settings.findUnique.mockResolvedValue({ ollamaModel: 'm' } as never)
})

function given(ids: string[]) {
  db.message.findMany.mockImplementation((async (a: { where: { OR?: unknown } }) =>
    a.where.OR ? ids.map((id) => ({ id })) : [notice, question]) as never) // kueri transkrip: urut baru -> lama
}

describe('refreshChatReview: automated notices (review Important A)', () => {
  it("question + automated notice -> reasons ['unreplied'] and the notice is labelled in the transcript; botTrace never loaded", async () => {
    given(['n1'])
    await refreshChatReview('c1', NOW)
    const [transcript, reasons] = vi.mocked(reviewConversation).mock.calls[0]
    expect(reasons).toEqual(['unreplied'])
    expect(transcript.text).toContain('Sistem (pesan otomatis): Noted')
    expect(transcript.text).toContain('Pelanggan: ganti kaos')
    const transcriptQuery = db.message.findMany.mock.calls.map((c) => c[0]).find((q) => !(q?.where as { OR?: unknown } | undefined)?.OR)
    expect(transcriptQuery?.select).not.toHaveProperty('botTrace')
  })

  it("a real reply last -> reasons ['active']", async () => {
    given([])
    await refreshChatReview('c1', NOW)
    expect(vi.mocked(reviewConversation).mock.calls[0][1]).toEqual(['active'])
    expect(vi.mocked(reviewConversation).mock.calls[0][0].text).not.toContain('Sistem (pesan otomatis)')
  })
})

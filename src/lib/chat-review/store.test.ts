/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))

import { prisma } from '@/lib/db'
import type { ConversationReview } from '@/lib/daily-summary/payload-schema'
import { saveChatReview } from './store'

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>
const review: ConversationReview = {
  status: 'selesai', alasan: 'a', jenisKontak: 'lainnya', topik: 't', pertanyaan: [], poinPenting: [], statusAgen: '', langkahBerikut: '',
}

beforeEach(() => mockReset(mockPrisma))

describe('saveChatReview', () => {
  it('hanya menulis bila chatReviewAt kosong, lebih lama, atau sama dengan asOf', async () => {
    mockPrisma.conversation.updateMany.mockResolvedValue({ count: 1 })
    const asOf = new Date('2026-10-19T00:00:00Z')
    expect(await saveChatReview('c1', review, asOf)).toBe(true)
    expect(mockPrisma.conversation.updateMany).toHaveBeenCalledWith({
      where: { id: 'c1', OR: [{ chatReviewAt: null }, { chatReviewAt: { lte: asOf } }] },
      data: { chatReview: review, chatReviewAt: asOf },
    })
  })

  it('mengembalikan false bila hasil yang lebih baru sudah ada (0 baris)', async () => {
    mockPrisma.conversation.updateMany.mockResolvedValue({ count: 0 })
    expect(await saveChatReview('c1', review, new Date())).toBe(false)
  })

  it('tidak pernah melempar', async () => {
    mockPrisma.conversation.updateMany.mockRejectedValue(new Error('db mati'))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(await saveChatReview('c1', review, new Date())).toBe(false)
  })
})

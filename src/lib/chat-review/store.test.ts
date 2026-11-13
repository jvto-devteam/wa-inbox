/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))

import { prisma } from '@/lib/db'
import type { ConversationReview } from '@/lib/daily-summary/payload-schema'
import { Prisma } from '@prisma/client'
import { pruneChatReviews, saveChatReview } from './store'

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>
const review: ConversationReview = {
  status: 'selesai', alasan: 'a', jenisKontak: 'lainnya', topik: 't', pertanyaan: [], poinPenting: [], janjiTim: [], profil: [], statusAgen: '', langkahBerikut: '',
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

  it('mempertahankan catatanCrew yang sudah tersimpan bila ringkasan baru tidak membawanya (job harian)', async () => {
    const kept = { diperbaruiAt: '2026-11-06T03:00:00.000Z', perubahan: ['Jemput 11:00, bukan 08:00.'], waktuKritis: [], siapa: [], karakter: [], kebutuhan: [], permintaan: [], logistik: [], janjiTim: [], jangan: [] }
    mockPrisma.conversation.findUnique.mockResolvedValue({ chatReview: { ...review, catatanCrew: kept } } as never)
    mockPrisma.conversation.updateMany.mockResolvedValue({ count: 1 })
    const asOf = new Date('2026-11-06T17:00:00Z')
    await saveChatReview('c1', review, asOf)
    expect(mockPrisma.conversation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { chatReview: { ...review, catatanCrew: kept }, chatReviewAt: asOf } })
    )
  })

  it('catatanCrew di ringkasan baru menang atas yang lama, tanpa membaca baris lama', async () => {
    const fresh = { diperbaruiAt: '2026-11-06T04:00:00.000Z', perubahan: [], waktuKritis: [], siapa: ['Pasangan.'], karakter: [], kebutuhan: [], permintaan: [], logistik: [], janjiTim: [], jangan: [] }
    const freshSchedule = { diperbaruiAt: '2026-11-06T04:00:00.000Z', baris: ['1 orang vegan'] }
    mockPrisma.conversation.updateMany.mockResolvedValue({ count: 1 })
    await saveChatReview('c1', { ...review, catatanCrew: fresh, catatanSchedule: freshSchedule }, new Date())
    expect(mockPrisma.conversation.findUnique).not.toHaveBeenCalled()
    expect(mockPrisma.conversation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ chatReview: { ...review, catatanCrew: fresh, catatanSchedule: freshSchedule } }) })
    )
  })

  it('mempertahankan catatanSchedule yang sudah tersimpan bila ringkasan baru tidak membawanya (job harian)', async () => {
    const kept = { diperbaruiAt: '2026-11-13T03:00:00.000Z', baris: ['2 tamu vegan', 'Minta AC mobil dingin'] }
    mockPrisma.conversation.findUnique.mockResolvedValue({ chatReview: { ...review, catatanSchedule: kept } } as never)
    mockPrisma.conversation.updateMany.mockResolvedValue({ count: 1 })
    const asOf = new Date('2026-11-13T17:00:00Z')
    await saveChatReview('c1', review, asOf)
    expect(mockPrisma.conversation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { chatReview: { ...review, catatanSchedule: kept }, chatReviewAt: asOf } })
    )
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

describe('pruneChatReviews', () => {
  it('mengosongkan ringkasan yang lebih tua dari 30 hari', async () => {
    mockPrisma.conversation.updateMany.mockResolvedValue({ count: 3 })
    const now = new Date('2026-10-19T00:00:00Z')
    await expect(pruneChatReviews(now)).resolves.toEqual({ cleared: 3 })
    expect(mockPrisma.conversation.updateMany).toHaveBeenCalledWith({
      where: { chatReviewAt: { lt: new Date('2026-09-19T00:00:00Z') } },
      data: { chatReview: Prisma.DbNull, chatReviewAt: null },
    })
  })

  it('tidak pernah melempar', async () => {
    mockPrisma.conversation.updateMany.mockRejectedValue(new Error('db mati'))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await expect(pruneChatReviews()).resolves.toEqual({ cleared: 0 })
  })
})

/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('./automated', () => ({ findOurReply: vi.fn() }))

import { prisma } from '@/lib/db'
import { findOurReply } from './automated'
import { closeExcludedItems, exclusionFor, potentialNewBooking, tripEnded } from './exclusion'

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>
const NOW = new Date('2026-11-25T05:00:00Z') // 12:00 WIB
const conv = (o: { phone?: string | null; isTest?: boolean; end?: string; chatReview?: unknown } = {}) => ({
  isTest: o.isTest ?? false,
  bookingData: o.end ? { date: { start_ymd: '2026-11-01', end_ymd: o.end } } : null,
  chatReview: o.chatReview ?? null,
  contact: { phone: o.phone === undefined ? '447700900123' : o.phone },
})

beforeEach(() => {
  mockReset(mockPrisma)
  vi.mocked(findOurReply).mockResolvedValue({ id: 'o1', createdAt: new Date('2026-11-20T00:00:00Z') })
  mockPrisma.message.findMany.mockResolvedValue([{ type: 'text' }] as never)
})

describe('tripEnded / potentialNewBooking', () => {
  it('trip selesai = end_ymd sebelum hari ini WIB', () => {
    expect(tripEnded({ date: { end_ymd: '2026-11-24' } }, '2026-11-25')).toBe(true)
    expect(tripEnded({ date: { end_ymd: '2026-11-25' } }, '2026-11-25')).toBe(false)
    expect(tripEnded(null, '2026-11-25')).toBe(false)
    expect(tripEnded({ date: { end_ymd: 'TBA' } }, '2026-11-25')).toBe(false)
  })
  it('potensi booking baru: calon_tamu atau ada belumBooking', () => {
    expect(potentialNewBooking({ jenisKontak: 'calon_tamu' })).toBe(true)
    expect(potentialNewBooking({ jenisKontak: 'tamu_existing', belumBooking: { alasan: 'harga' } })).toBe(true)
    expect(potentialNewBooking({ jenisKontak: 'tamu_existing' })).toBe(false)
    expect(potentialNewBooking(null)).toBe(false)
  })
})

describe('exclusionFor', () => {
  it('nomor Indonesia keluar untuk semua jenis; percakapan uji tetap masuk', async () => {
    mockPrisma.conversation.findUnique.mockResolvedValue(conv({ phone: '6281234567890' }) as never)
    expect(await exclusionFor('c', 'REPLY', null, NOW)).toBe('NOMOR_INDONESIA')
    expect(await exclusionFor('c', 'PROMISE', null, NOW)).toBe('NOMOR_INDONESIA')
    mockPrisma.conversation.findUnique.mockResolvedValue(conv({ phone: '6281234567890', isTest: true }) as never)
    expect(await exclusionFor('c', 'REPLY', null, NOW)).toBeNull()
  })

  it('Belum dibalas yang rangkaiannya hanya reaksi keluar; ada teks = tetap masuk', async () => {
    mockPrisma.conversation.findUnique.mockResolvedValue(conv() as never)
    mockPrisma.message.findMany.mockResolvedValue([{ type: 'reaction' }, { type: 'reaction' }] as never)
    expect(await exclusionFor('c', 'REPLY', null, NOW)).toBe('HANYA_REAKSI')
    expect(mockPrisma.message.findMany.mock.calls[0][0]).toMatchObject({ where: { direction: 'INBOUND', createdAt: { gt: new Date('2026-11-20T00:00:00Z') } } })
    mockPrisma.message.findMany.mockResolvedValue([{ type: 'reaction' }, { type: 'text' }] as never)
    expect(await exclusionFor('c', 'REPLY', null, NOW)).toBeNull()
  })

  it('Follow Up / Janji untuk trip yang sudah selesai keluar, kecuali potensi booking baru; trip belum jalan tetap masuk', async () => {
    mockPrisma.conversation.findUnique.mockResolvedValue(conv({ end: '2026-11-20', chatReview: { jenisKontak: 'tamu_existing' } }) as never)
    expect(await exclusionFor('c', 'PROMISE', null, NOW)).toBe('TRIP_SELESAI')
    expect(await exclusionFor('c', 'FOLLOW_UP', null, NOW)).toBe('TRIP_SELESAI')
    // Balas tidak terkena aturan trip selesai
    expect(await exclusionFor('c', 'REPLY', null, NOW)).toBeNull()
    mockPrisma.conversation.findUnique.mockResolvedValue(conv({ end: '2026-11-20', chatReview: { jenisKontak: 'calon_tamu' } }) as never)
    expect(await exclusionFor('c', 'PROMISE', null, NOW)).toBeNull()
    mockPrisma.conversation.findUnique.mockResolvedValue(conv({ end: '2026-11-30' }) as never)
    expect(await exclusionFor('c', 'PROMISE', null, NOW)).toBeNull()
  })
})

describe('closeExcludedItems', () => {
  it('menutup item OPEN yang kena aturan dengan NOT_QUEUED + alasan; yang lain tidak disentuh', async () => {
    mockPrisma.summaryItem.findMany.mockResolvedValue([
      { id: 'i1', conversationId: 'indo', kind: 'REPLY', review: null },
      { id: 'i2', conversationId: 'ok', kind: 'REPLY', review: null },
    ] as never)
    mockPrisma.conversation.findUnique.mockImplementation((async (a: { where: { id: string } }) =>
      a.where.id === 'indo' ? conv({ phone: '6281234567890' }) : conv()) as never)
    mockPrisma.summaryItem.updateMany.mockResolvedValue({ count: 1 })

    expect(await closeExcludedItems(NOW)).toBe(1)
    expect(mockPrisma.summaryItem.findMany.mock.calls[0][0]).toMatchObject({ where: { state: 'OPEN' } })
    expect(mockPrisma.summaryItem.updateMany).toHaveBeenCalledTimes(1)
    expect(mockPrisma.summaryItem.updateMany.mock.calls[0][0]).toEqual({
      where: { id: 'i1', state: 'OPEN' },
      data: { state: 'DONE', closedReason: 'NOT_QUEUED', note: 'Nomor Indonesia', closedAt: NOW },
    })
  })
})

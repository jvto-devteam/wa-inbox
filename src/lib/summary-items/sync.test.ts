/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import { Prisma, type PrismaClient } from '@prisma/client'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))

import { prisma } from '@/lib/db'
import { RETENTION_MS } from '@/lib/daily-summary/config'
import type { DailySummaryPayload } from '@/lib/daily-summary/payload-schema'
import { applyReviewToItem, pruneSummaryItems, reconcileSummaryItems, syncSummaryItems } from './sync'

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>
const NOW = new Date('2026-10-18T10:00:00Z')
const at = (iso: string) => new Date(iso)

function payload(
  over: Partial<Pick<DailySummaryPayload, 'unreplied' | 'dormant' | 'handoffs' | 'newLeads' | 'conversations'>> = {}
): DailySummaryPayload {
  return { unreplied: [], dormant: [], handoffs: [], newLeads: [], conversations: [], ...over } as unknown as DailySummaryPayload
}
const unreplied = (id: string, lastMessageAt: string) => ({
  conversationId: id, contactName: 'Budi', pipelineStage: 'new', lastMessageAt, lastMessageId: `m-${id}`, waitingMs: 1, snippet: 'halo', review: null,
})
const row = (over: Record<string, unknown> = {}) => ({
  id: 'i1', conversationId: 'c1', kind: 'REPLY', state: 'OPEN', anchorAt: at('2026-10-17T01:00:00Z'), anchorMessageId: 'm1', snippet: 'halo',
  review: null, handoff: false, newLead: false, openedOn: '2026-10-16', lastSeenOn: '2026-10-17', reminderId: null, dueAt: null,
  closedReason: null, note: null, closedById: null, closedAt: null, ...over,
})

beforeEach(() => {
  mockReset(mockPrisma)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('syncSummaryItems', () => {
  it('membuat item baru OPEN dengan openedOn = lastSeenOn = tanggal', async () => {
    mockPrisma.summaryItem.findUnique.mockResolvedValue(null)
    const r = await syncSummaryItems('2026-10-17', payload({ unreplied: [unreplied('c1', '2026-10-17T01:00:00Z')] as never }), NOW)
    expect(r).toEqual({ created: 1, updated: 0, reopened: 0, closed: 0 })
    const data = mockPrisma.summaryItem.create.mock.calls[0][0].data
    expect(data).toMatchObject({ conversationId: 'c1', kind: 'REPLY', state: 'OPEN', openedOn: '2026-10-17', lastSeenOn: '2026-10-17', anchorMessageId: 'm-c1', review: Prisma.DbNull })
  })

  it('item OPEN: openedOn tetap, lastSeenOn naik', async () => {
    mockPrisma.summaryItem.findUnique.mockResolvedValue(row() as never)
    const r = await syncSummaryItems('2026-10-18', payload({ unreplied: [unreplied('c1', '2026-10-17T01:00:00Z')] as never }), NOW)
    expect(r.updated).toBe(1)
    const data = mockPrisma.summaryItem.update.mock.calls[0][0].data
    expect(data.lastSeenOn).toBe('2026-10-18')
    expect(data).not.toHaveProperty('openedOn')
    expect(data).not.toHaveProperty('state')
  })

  it('DONE dengan anchor lebih baru dari closedAt dibuka ulang dan penutupan dikosongkan', async () => {
    mockPrisma.summaryItem.findUnique.mockResolvedValue(
      row({ state: 'DONE', closedReason: 'REPLIED', closedAt: at('2026-10-17T05:00:00Z'), note: 'x', closedById: 'a', reminderId: 'r', dueAt: NOW }) as never
    )
    const r = await syncSummaryItems('2026-10-18', payload({ unreplied: [unreplied('c1', '2026-10-17T08:00:00Z')] as never }), NOW)
    expect(r.reopened).toBe(1)
    expect(mockPrisma.summaryItem.update.mock.calls[0][0].data).toMatchObject({
      state: 'OPEN', openedOn: '2026-10-18', lastSeenOn: '2026-10-18', closedReason: null, note: null, closedById: null, closedAt: null, reminderId: null, dueAt: null,
    })
  })

  it('DROPPED dengan anchor sama/lebih lama tidak disentuh', async () => {
    mockPrisma.summaryItem.findUnique.mockResolvedValue(row({ state: 'DROPPED', closedReason: 'DROPPED', closedAt: at('2026-10-17T05:00:00Z') }) as never)
    const r = await syncSummaryItems('2026-10-18', payload({ unreplied: [unreplied('c1', '2026-10-17T01:00:00Z')] as never }), NOW)
    expect(r).toEqual({ created: 0, updated: 0, reopened: 0, closed: 0 })
    expect(mockPrisma.summaryItem.update).not.toHaveBeenCalled()
  })

  it('DROPPED REPLY, kandidat inbound lebih baru dari anchor baris tapi lebih lama dari closedAt -> dibuka ulang', async () => {
    mockPrisma.summaryItem.findUnique.mockResolvedValue(
      row({ state: 'DROPPED', closedReason: 'DROPPED', anchorAt: at('2026-10-17T01:00:00Z'), closedAt: at('2026-10-17T14:00:00Z') }) as never
    )
    const r = await syncSummaryItems('2026-10-18', payload({ unreplied: [unreplied('c1', '2026-10-17T10:00:00Z')] as never }), NOW)
    expect(r.reopened).toBe(1)
    expect(mockPrisma.summaryItem.update.mock.calls[0][0].data).toMatchObject({ state: 'OPEN', closedAt: null, anchorAt: at('2026-10-17T10:00:00Z') })
  })

  it('DONE/REMINDER_DONE REPLY, kandidat lebih baru dari anchor baris -> dibuka ulang', async () => {
    mockPrisma.summaryItem.findUnique.mockResolvedValue(
      row({ state: 'DONE', closedReason: 'REMINDER_DONE', closedAt: at('2026-10-17T14:00:00Z') }) as never
    )
    const r = await syncSummaryItems('2026-10-18', payload({ unreplied: [unreplied('c1', '2026-10-17T10:00:00Z')] as never }), NOW)
    expect(r.reopened).toBe(1)
  })

  it('REPLIED REPLY tetap memakai aturan closedAt (kandidat lebih lama dari closedAt tidak membuka)', async () => {
    mockPrisma.summaryItem.findUnique.mockResolvedValue(
      row({ state: 'DONE', closedReason: 'REPLIED', closedAt: at('2026-10-17T14:00:00Z') }) as never
    )
    const r = await syncSummaryItems('2026-10-18', payload({ unreplied: [unreplied('c1', '2026-10-17T10:00:00Z')] as never }), NOW)
    expect(r.reopened).toBe(0)
    expect(mockPrisma.summaryItem.update).not.toHaveBeenCalled()
  })

  it('FOLLOW_UP REPLIED, kandidat dormant dengan anchor > closedAt -> dibuka ulang', async () => {
    mockPrisma.summaryItem.findUnique.mockResolvedValue(
      row({ kind: 'FOLLOW_UP', state: 'DONE', closedReason: 'REPLIED', closedAt: at('2026-10-17T05:00:00Z') }) as never
    )
    const dormant = { ...unreplied('c1', '2026-10-17T08:00:00Z') }
    const r = await syncSummaryItems('2026-10-18', payload({ dormant: [dormant] as never }), NOW)
    expect(r.reopened).toBe(1)
    expect(mockPrisma.summaryItem.update.mock.calls[0][0].data).toMatchObject({ kind: 'FOLLOW_UP', state: 'OPEN', closedAt: null })
  })

  it('ringkasan tanggal lama (date < lastSeenOn) tidak menimpa item OPEN', async () => {
    mockPrisma.summaryItem.findUnique.mockResolvedValue(row({ lastSeenOn: '2026-10-17' }) as never)
    const r = await syncSummaryItems('2026-10-15', payload({ unreplied: [unreplied('c1', '2026-10-14T01:00:00Z')] as never }), NOW)
    expect(r).toEqual({ created: 0, updated: 0, reopened: 0, closed: 0 })
    expect(mockPrisma.summaryItem.update).not.toHaveBeenCalled()
  })

  it('menelan error', async () => {
    mockPrisma.summaryItem.findUnique.mockRejectedValue(new Error('db down'))
    await expect(syncSummaryItems('2026-10-18', payload({ unreplied: [unreplied('c1', '2026-10-17T05:00:00Z')] as never }), NOW)).resolves.toEqual({ created: 0, updated: 0, reopened: 0, closed: 0 })
  })
})

describe('janji tim (PROMISE)', () => {
  const DATE = '2026-10-18'
  // Akhir hari WIB 18 Oktober = 18 Oktober 17.00 UTC; job malam berjalan sesudahnya.
  const DAY_END = at('2026-10-18T17:00:00Z')
  const AFTER = at('2026-10-18T17:05:00Z')
  const review = (janjiTim: unknown[]) => ({
    status: 'perlu_tindakan', alasan: 'a', jenisKontak: 'calon_tamu', topik: 'Ijen', pertanyaan: [], poinPenting: [],
    janjiTim, statusAgen: '', langkahBerikut: 'Kirim invoice',
  })
  const unkept = review([{ teks: 'Kirim invoice', terpenuhi: false, messageId: 'mj' }, { teks: 'Cek kamar', terpenuhi: true }])
  const kept = review([{ teks: 'Kirim invoice', terpenuhi: true, messageId: 'mj' }])
  const active = (id: string, r: unknown) => ({ conversationId: id, contactName: 'Budi', pipelineStage: 'new', inbound: 1, outbound: 1, review: r })
  const promiseAt = at('2026-10-18T03:00:00Z')

  beforeEach(() => {
    mockPrisma.summaryItem.findMany.mockResolvedValue([])
  })

  it('janji terbuka pada percakapan yang bukan REPLY/FOLLOW_UP -> PROMISE, anchor = waktu pesan janji', async () => {
    mockPrisma.summaryItem.findUnique.mockResolvedValue(null)
    mockPrisma.message.findFirst.mockResolvedValue({ id: 'mj', createdAt: promiseAt } as never)
    const r = await syncSummaryItems(DATE, payload({ conversations: [active('c2', unkept)] as never }), AFTER)
    expect(r.created).toBe(1)
    // Lookup dibatasi ke percakapan itu, hanya janji yang belum ditepati.
    expect(mockPrisma.message.findFirst.mock.calls[0][0]).toMatchObject({ where: { id: { in: ['mj'] }, conversationId: 'c2' }, orderBy: { createdAt: 'desc' } })
    expect(mockPrisma.summaryItem.create.mock.calls[0][0].data).toMatchObject({
      conversationId: 'c2', kind: 'PROMISE', state: 'OPEN', anchorAt: promiseAt, anchorMessageId: 'mj', snippet: 'Kirim invoice', handoff: false,
    })
  })

  it('pesan janji tidak diketahui -> anchor = akhir hari ringkasan', async () => {
    mockPrisma.summaryItem.findUnique.mockResolvedValue(null)
    const r = await syncSummaryItems(DATE, payload({ conversations: [active('c2', review([{ teks: 'Itinerary besok', terpenuhi: false }]))] as never }), AFTER)
    expect(r.created).toBe(1)
    expect(mockPrisma.message.findFirst).not.toHaveBeenCalled()
    expect(mockPrisma.summaryItem.create.mock.calls[0][0].data).toMatchObject({ kind: 'PROMISE', anchorAt: DAY_END, anchorMessageId: null, snippet: 'Itinerary besok' })
  })

  it('"Buat ulang" untuk hari yang belum selesai: anchor cadangan = sekarang, bukan akhir hari', async () => {
    mockPrisma.summaryItem.findUnique.mockResolvedValue(null)
    await syncSummaryItems(DATE, payload({ conversations: [active('c2', review([{ teks: 'Itinerary', terpenuhi: false }]))] as never }), NOW)
    expect(mockPrisma.summaryItem.create.mock.calls[0][0].data.anchorAt).toEqual(NOW)
  })

  it('janji string lama atau terpenuhi:true tidak membuat item', async () => {
    vi.mocked(console.error).mockClear()
    mockPrisma.summaryItem.findUnique.mockResolvedValue(null)
    const r = await syncSummaryItems(DATE, payload({ conversations: [active('c2', review(['Invoice menyusul'])), active('c3', kept)] as never }), AFTER)
    expect(r.created).toBe(0)
    expect(mockPrisma.summaryItem.create).not.toHaveBeenCalled()
    // Lolos tanpa error yang tertelan, bukan karena sync gagal diam-diam.
    expect(console.error).not.toHaveBeenCalled()
  })

  it('REPLY menang: percakapan yang belum dibalas dan punya janji terbuka hanya jadi REPLY', async () => {
    mockPrisma.summaryItem.findUnique.mockResolvedValue(null)
    const waiting = { ...unreplied('c1', '2026-10-18T05:00:00Z'), review: unkept }
    const r = await syncSummaryItems(DATE, payload({ unreplied: [waiting] as never, conversations: [active('c1', unkept)] as never }), AFTER)
    expect(r.created).toBe(1)
    expect(mockPrisma.summaryItem.create).toHaveBeenCalledTimes(1)
    expect(mockPrisma.summaryItem.create.mock.calls[0][0].data.kind).toBe('REPLY')
  })

  it('REPLY yang masih OPEN tidak diturunkan jadi PROMISE', async () => {
    mockPrisma.summaryItem.findUnique.mockResolvedValue(row({ kind: 'REPLY', lastSeenOn: '2026-10-17' }) as never)
    mockPrisma.message.findFirst.mockResolvedValue({ id: 'mj', createdAt: promiseAt } as never)
    const r = await syncSummaryItems(DATE, payload({ conversations: [active('c1', unkept)] as never }), AFTER)
    expect(r).toEqual({ created: 0, updated: 0, reopened: 0, closed: 0 })
    expect(mockPrisma.summaryItem.update).not.toHaveBeenCalled()
  })

  it('PROMISE yang OPEN berubah jadi REPLY bila percakapan itu kandidat REPLY', async () => {
    mockPrisma.summaryItem.findUnique.mockResolvedValue(row({ kind: 'PROMISE', lastSeenOn: '2026-10-17' }) as never)
    const r = await syncSummaryItems(DATE, payload({ unreplied: [unreplied('c1', '2026-10-18T05:00:00Z')] as never }), AFTER)
    expect(r.updated).toBe(1)
    expect(mockPrisma.summaryItem.update.mock.calls[0][0].data).toMatchObject({ kind: 'REPLY', anchorMessageId: 'm-c1' })
  })

  it('DROPPED PROMISE dengan janji yang sama tidak dibuka lagi; janji sesudah closedAt membukanya', async () => {
    const dropped = row({ kind: 'PROMISE', state: 'DROPPED', closedReason: 'DROPPED', anchorAt: promiseAt, closedAt: at('2026-10-18T04:00:00Z') })
    mockPrisma.summaryItem.findUnique.mockResolvedValue(dropped as never)
    mockPrisma.message.findFirst.mockResolvedValue({ id: 'mj', createdAt: promiseAt } as never)
    expect((await syncSummaryItems(DATE, payload({ conversations: [active('c1', unkept)] as never }), AFTER)).reopened).toBe(0)

    const later = at('2026-10-18T06:00:00Z')
    mockPrisma.message.findFirst.mockResolvedValue({ id: 'mj', createdAt: later } as never)
    expect((await syncSummaryItems(DATE, payload({ conversations: [active('c1', unkept)] as never }), AFTER)).reopened).toBe(1)
    expect(mockPrisma.summaryItem.update.mock.calls[0][0].data).toMatchObject({ kind: 'PROMISE', state: 'OPEN', anchorAt: later, closedAt: null })
  })

  it('review berikutnya tanpa janji terbuka menutup PROMISE: DONE/PROMISE_KEPT, closedAt = akhir hari, pengingat selesai', async () => {
    mockPrisma.summaryItem.findUnique.mockResolvedValue(null)
    mockPrisma.summaryItem.findMany.mockResolvedValue([row({ kind: 'PROMISE', state: 'SCHEDULED', anchorAt: promiseAt, reminderId: 'r1', lastSeenOn: '2026-10-17' })] as never)
    const r = await syncSummaryItems(DATE, payload({ conversations: [active('c1', kept)] as never }), AFTER)
    expect(r).toEqual({ created: 0, updated: 0, reopened: 0, closed: 1 })
    expect(mockPrisma.summaryItem.findMany.mock.calls[0][0]).toEqual({
      where: { conversationId: { in: ['c1'] }, kind: 'PROMISE', state: { in: ['OPEN', 'SCHEDULED'] } },
    })
    expect(mockPrisma.summaryItem.update.mock.calls[0][0].data).toMatchObject({ state: 'DONE', closedReason: 'PROMISE_KEPT', closedAt: DAY_END })
    expect(mockPrisma.reminder.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: 'r1', done: false }, data: { done: true } })
  })

  it('ringkasan tanggal lama tidak menutup PROMISE yang dilihat ringkasan lebih baru', async () => {
    mockPrisma.summaryItem.findMany.mockResolvedValue([row({ kind: 'PROMISE', anchorAt: promiseAt, lastSeenOn: '2026-10-19' })] as never)
    const r = await syncSummaryItems(DATE, payload({ conversations: [active('c1', kept)] as never }), AFTER)
    expect(r.closed).toBe(0)
    expect(mockPrisma.summaryItem.update).not.toHaveBeenCalled()
  })

  it('review tanpa janji tidak menyentuh item REPLY/FOLLOW_UP', async () => {
    // Kueri sudah menyaring kind; penjaga di kode tetap menolak bila baris lain ikut terbawa.
    mockPrisma.summaryItem.findMany.mockResolvedValue([row({ kind: 'FOLLOW_UP' })] as never)
    const r = await syncSummaryItems(DATE, payload({ conversations: [active('c1', kept)] as never }), AFTER)
    expect(r.closed).toBe(0)
    expect(mockPrisma.summaryItem.update).not.toHaveBeenCalled()
  })
})

describe('applyReviewToItem (tombol Perbarui)', () => {
  const review = (janjiTim: unknown[]) =>
    ({ status: 'selesai', alasan: 'a', jenisKontak: 'calon_tamu', topik: 't', pertanyaan: [], poinPenting: [], janjiTim, statusAgen: '', langkahBerikut: '' }) as never
  const promiseRow = (over: Record<string, unknown> = {}) => row({ kind: 'PROMISE', anchorAt: at('2026-10-17T03:00:00Z'), ...over })

  it('tanpa janji terbuka -> DONE/PROMISE_KEPT dengan closedAt = asOf', async () => {
    mockPrisma.summaryItem.findUnique.mockResolvedValue(promiseRow() as never)
    await expect(applyReviewToItem('c1', review([{ teks: 'Invoice', terpenuhi: true }]), NOW)).resolves.toBe('closed')
    expect(mockPrisma.summaryItem.update.mock.calls[0][0]).toMatchObject({ where: { id: 'i1' }, data: { state: 'DONE', closedReason: 'PROMISE_KEPT', closedAt: NOW } })
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1)
  })

  it('janji masih terbuka -> hanya review di item yang disegarkan', async () => {
    mockPrisma.summaryItem.findUnique.mockResolvedValue(promiseRow() as never)
    const r = review([{ teks: 'Invoice', terpenuhi: false }])
    await expect(applyReviewToItem('c1', r, NOW)).resolves.toBe('updated')
    expect(mockPrisma.summaryItem.update.mock.calls[0][0]).toEqual({ where: { id: 'i1' }, data: { review: r } })
  })

  it.each([
    ['item REPLY', row()],
    ['PROMISE yang sudah DONE', promiseRow({ state: 'DONE', closedReason: 'REPLIED', closedAt: NOW })],
    ['review lebih tua dari janjinya', promiseRow({ anchorAt: at('2026-10-18T11:00:00Z') })],
  ])('%s tidak disentuh', async (_label, existing) => {
    mockPrisma.summaryItem.findUnique.mockResolvedValue(existing as never)
    await expect(applyReviewToItem('c1', review([]), NOW)).resolves.toBe('unchanged')
    expect(mockPrisma.summaryItem.update).not.toHaveBeenCalled()
  })

  it('tanpa item atau saat error -> unchanged, tidak melempar', async () => {
    mockPrisma.summaryItem.findUnique.mockResolvedValue(null)
    await expect(applyReviewToItem('c1', review([]), NOW)).resolves.toBe('unchanged')
    mockPrisma.summaryItem.findUnique.mockRejectedValue(new Error('db down'))
    await expect(applyReviewToItem('c1', review([]), NOW)).resolves.toBe('unchanged')
  })
})

describe('reconcileSummaryItems', () => {
  const inbound = { id: 'in1', direction: 'INBOUND', sentBy: 'CUSTOMER', type: 'TEXT', content: 'masih ada?', createdAt: at('2026-10-18T02:00:00Z') }

  it('REPLY dengan OUTBOUND sesudah anchor -> DONE/REPLIED dan reminder done', async () => {
    mockPrisma.summaryItem.findMany.mockResolvedValue([row({ state: 'SCHEDULED', reminderId: 'r1' })] as never)
    const sentAt = at('2026-10-17T03:00:00Z')
    mockPrisma.message.findFirst.mockResolvedValue({ id: 'o1', createdAt: sentAt } as never)
    const r = await reconcileSummaryItems(NOW)
    expect(r).toEqual({ closed: 1, converted: 0, reopened: 0 })
    // closedAt = waktu balasan, bukan NOW.
    expect(mockPrisma.summaryItem.update.mock.calls[0][0].data).toMatchObject({ state: 'DONE', closedReason: 'REPLIED', closedAt: sentAt })
    expect(mockPrisma.reminder.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: 'r1' }, data: { done: true } })
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1)
  })

  it('FOLLOW_UP + inbound -> REPLY dengan anchor inbound', async () => {
    mockPrisma.summaryItem.findMany.mockResolvedValue([row({ kind: 'FOLLOW_UP' })] as never)
    mockPrisma.message.findFirst.mockImplementation((async (a: { where: { direction: string } }) => (a.where.direction === 'INBOUND' ? inbound : null)) as never)
    const r = await reconcileSummaryItems(NOW)
    expect(r).toEqual({ closed: 0, converted: 1, reopened: 0 })
    expect(mockPrisma.summaryItem.update.mock.calls[0][0].data).toMatchObject({
      kind: 'REPLY', state: 'OPEN', anchorAt: inbound.createdAt, anchorMessageId: 'in1', snippet: 'masih ada?', reminderId: null, dueAt: null,
    })
  })

  it('FOLLOW_UP + inbound + outbound sesudahnya -> DONE', async () => {
    mockPrisma.summaryItem.findMany.mockResolvedValue([row({ kind: 'FOLLOW_UP' })] as never)
    const sentAt = at('2026-10-18T03:00:00Z')
    mockPrisma.message.findFirst.mockImplementation((async (a: { where: { direction: string } }) => (a.where.direction === 'INBOUND' ? inbound : { id: 'o1', createdAt: sentAt })) as never)
    const r = await reconcileSummaryItems(NOW)
    expect(r).toMatchObject({ closed: 1, converted: 1 })
    // Kueri OUTBOUND harus memakai anchor baru (pesan inbound), bukan anchor lama.
    const outboundQuery = mockPrisma.message.findFirst.mock.calls.map((c) => c[0] as { where: { direction: string; createdAt: unknown } }).find((q) => q.where.direction === 'OUTBOUND')
    expect(outboundQuery?.where.createdAt).toEqual({ gt: inbound.createdAt })
    expect(mockPrisma.summaryItem.update.mock.calls[0][0].data).toMatchObject({ state: 'DONE', closedReason: 'REPLIED', kind: 'REPLY', closedAt: sentAt })
  })

  it('SCHEDULED + reminder done -> DONE/REMINDER_DONE', async () => {
    mockPrisma.summaryItem.findMany.mockResolvedValue([row({ kind: 'FOLLOW_UP', state: 'SCHEDULED', reminderId: 'r1' })] as never)
    mockPrisma.message.findFirst.mockResolvedValue(null)
    mockPrisma.reminder.findUnique.mockResolvedValue({ id: 'r1', done: true, dueAt: at('2026-10-20T00:00:00Z') } as never)
    const r = await reconcileSummaryItems(NOW)
    expect(r.closed).toBe(1)
    expect(mockPrisma.summaryItem.update.mock.calls[0][0].data).toMatchObject({ state: 'DONE', closedReason: 'REMINDER_DONE', closedAt: NOW })
  })

  it('SCHEDULED + dueAt lewat -> OPEN, reminderId dipertahankan', async () => {
    mockPrisma.summaryItem.findMany.mockResolvedValue([row({ kind: 'FOLLOW_UP', state: 'SCHEDULED', reminderId: 'r1' })] as never)
    mockPrisma.message.findFirst.mockResolvedValue(null)
    mockPrisma.reminder.findUnique.mockResolvedValue({ id: 'r1', done: false, dueAt: at('2026-10-18T09:00:00Z') } as never)
    const r = await reconcileSummaryItems(NOW)
    expect(r.reopened).toBe(1)
    const data = mockPrisma.summaryItem.update.mock.calls[0][0].data
    expect(data).toEqual({ state: 'OPEN' })
  })

  it('SCHEDULED + reminder hilang -> OPEN, reminderId dikosongkan', async () => {
    mockPrisma.summaryItem.findMany.mockResolvedValue([row({ kind: 'FOLLOW_UP', state: 'SCHEDULED', reminderId: 'r1' })] as never)
    mockPrisma.message.findFirst.mockResolvedValue(null)
    mockPrisma.reminder.findUnique.mockResolvedValue(null)
    await reconcileSummaryItems(NOW)
    expect(mockPrisma.summaryItem.update.mock.calls[0][0].data).toEqual({ state: 'OPEN', reminderId: null, dueAt: null })
  })

  it('OPEN + reminderId + reminder done -> DONE/REMINDER_DONE', async () => {
    mockPrisma.summaryItem.findMany.mockResolvedValue([row({ state: 'OPEN', reminderId: 'r1', dueAt: at('2026-10-18T09:00:00Z') })] as never)
    mockPrisma.message.findFirst.mockResolvedValue(null)
    mockPrisma.reminder.findUnique.mockResolvedValue({ id: 'r1', done: true, dueAt: at('2026-10-18T09:00:00Z') } as never)
    const r = await reconcileSummaryItems(NOW)
    expect(r.closed).toBe(1)
    expect(mockPrisma.summaryItem.update.mock.calls[0][0].data).toMatchObject({ state: 'DONE', closedReason: 'REMINDER_DONE', closedAt: NOW })
  })

  it('OPEN + reminderId + reminder hilang -> reminderId dikosongkan, tetap OPEN', async () => {
    mockPrisma.summaryItem.findMany.mockResolvedValue([row({ state: 'OPEN', reminderId: 'r1' })] as never)
    mockPrisma.message.findFirst.mockResolvedValue(null)
    mockPrisma.reminder.findUnique.mockResolvedValue(null)
    const r = await reconcileSummaryItems(NOW)
    expect(r.reopened).toBe(0)
    expect(mockPrisma.summaryItem.update.mock.calls[0][0].data).toEqual({ state: 'OPEN', reminderId: null, dueAt: null })
  })

  it('OPEN + reminder belum selesai dan sudah jatuh tempo -> tidak ada tulisan', async () => {
    mockPrisma.summaryItem.findMany.mockResolvedValue([row({ state: 'OPEN', reminderId: 'r1' })] as never)
    mockPrisma.message.findFirst.mockResolvedValue(null)
    mockPrisma.reminder.findUnique.mockResolvedValue({ id: 'r1', done: false, dueAt: at('2026-10-18T09:00:00Z') } as never)
    await reconcileSummaryItems(NOW)
    expect(mockPrisma.summaryItem.update).not.toHaveBeenCalled()
  })

  describe('FOLLOW_UP tanpa inbound baru', () => {
    it('ada OUTBOUND sesudah anchor -> DONE/REPLIED, closedAt = waktu pesan, reminder done', async () => {
      mockPrisma.summaryItem.findMany.mockResolvedValue([row({ kind: 'FOLLOW_UP', state: 'SCHEDULED', reminderId: 'r1' })] as never)
      const sentAt = at('2026-10-17T09:00:00Z')
      mockPrisma.message.findFirst.mockImplementation((async (a: { where: { direction: string } }) => (a.where.direction === 'OUTBOUND' ? { id: 'o1', createdAt: sentAt } : null)) as never)
      const r = await reconcileSummaryItems(NOW)
      expect(r).toEqual({ closed: 1, converted: 0, reopened: 0 })
      expect(mockPrisma.summaryItem.update.mock.calls[0][0].data).toMatchObject({ state: 'DONE', closedReason: 'REPLIED', closedAt: sentAt })
      expect(mockPrisma.reminder.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: 'r1' }, data: { done: true } })
    })

    it('tanpa OUTBOUND tapi tahap sudah maju -> DONE/STAGE_ADVANCED, closedAt = now', async () => {
      mockPrisma.summaryItem.findMany.mockResolvedValue([row({ kind: 'FOLLOW_UP', reminderId: 'r1' })] as never)
      mockPrisma.message.findFirst.mockResolvedValue(null)
      mockPrisma.conversation.findUnique.mockResolvedValue({ pipelineStage: 'booked' } as never)
      const r = await reconcileSummaryItems(NOW)
      expect(r.closed).toBe(1)
      expect(mockPrisma.summaryItem.update.mock.calls[0][0].data).toMatchObject({ state: 'DONE', closedReason: 'STAGE_ADVANCED', closedAt: NOW })
      expect(mockPrisma.reminder.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: 'r1' }, data: { done: true } })
    })

    it('tahap masih dormant dan tanpa OUTBOUND -> tidak disentuh', async () => {
      mockPrisma.summaryItem.findMany.mockResolvedValue([row({ kind: 'FOLLOW_UP' })] as never)
      mockPrisma.message.findFirst.mockResolvedValue(null)
      mockPrisma.conversation.findUnique.mockResolvedValue({ pipelineStage: 'nego' } as never)
      const r = await reconcileSummaryItems(NOW)
      expect(r).toEqual({ closed: 0, converted: 0, reopened: 0 })
      expect(mockPrisma.summaryItem.update).not.toHaveBeenCalled()
    })
  })

  describe('PROMISE', () => {
    it('inbound sesudah anchor -> REPLY dengan anchor inbound (seperti FOLLOW_UP)', async () => {
      mockPrisma.summaryItem.findMany.mockResolvedValue([row({ kind: 'PROMISE', state: 'SCHEDULED', reminderId: 'r1' })] as never)
      mockPrisma.message.findFirst.mockImplementation((async (a: { where: { direction: string } }) => (a.where.direction === 'INBOUND' ? inbound : null)) as never)
      const r = await reconcileSummaryItems(NOW)
      expect(r.converted).toBe(1)
      expect(mockPrisma.summaryItem.update.mock.calls[0][0].data).toMatchObject({
        kind: 'REPLY', state: 'OPEN', anchorAt: inbound.createdAt, anchorMessageId: 'in1', reminderId: null, dueAt: null,
      })
      expect(mockPrisma.reminder.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: 'r1' }, data: { done: true } })
    })

    it('pesan keluar sesudah janji TIDAK menutupnya, dan tahap pipeline tidak dicek', async () => {
      mockPrisma.summaryItem.findMany.mockResolvedValue([row({ kind: 'PROMISE' })] as never)
      mockPrisma.message.findFirst.mockImplementation((async (a: { where: { direction: string } }) => (a.where.direction === 'OUTBOUND' ? { id: 'o1', createdAt: NOW } : null)) as never)
      const r = await reconcileSummaryItems(NOW)
      expect(r).toEqual({ closed: 0, converted: 0, reopened: 0 })
      expect(mockPrisma.summaryItem.update).not.toHaveBeenCalled()
      expect(mockPrisma.conversation.findUnique).not.toHaveBeenCalled()
    })
  })

  it('menelan error', async () => {
    mockPrisma.summaryItem.findMany.mockRejectedValue(new Error('db down'))
    await expect(reconcileSummaryItems(NOW)).resolves.toEqual({ closed: 0, converted: 0, reopened: 0 })
  })
})

describe('pruneSummaryItems', () => {
  it('memakai batas 30 hari dari closedAt', async () => {
    mockPrisma.summaryItem.deleteMany.mockResolvedValue({ count: 2 })
    await expect(pruneSummaryItems(NOW)).resolves.toEqual({ deleted: 2 })
    expect(mockPrisma.summaryItem.deleteMany.mock.calls[0][0]).toEqual({
      where: { state: { in: ['DONE', 'DROPPED'] }, closedAt: { lt: new Date(NOW.getTime() - RETENTION_MS) } },
    })
    expect(RETENTION_MS).toBe(30 * 24 * 3600 * 1000)
  })

  it('menelan error', async () => {
    mockPrisma.summaryItem.deleteMany.mockRejectedValue(new Error('x'))
    await expect(pruneSummaryItems(NOW)).resolves.toEqual({ deleted: 0 })
  })
})

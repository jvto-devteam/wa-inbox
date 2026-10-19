/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import { Prisma, type PrismaClient } from '@prisma/client'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))

import { prisma } from '@/lib/db'
import { RETENTION_MS } from '@/lib/daily-summary/config'
import { jakartaDayRange } from '@/lib/daily-summary/time'
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

/**
 * Tiruan prisma yang MENYIMPAN state (item, pesan, pengingat, chatReviewAt), supaya urutan job
 * malam → rekonsiliasi → Perbarui bisa dijalankan seperti di produksi. Kasus-kasusnya berasal dari
 * repro review 2026-10-19 (janji hilang di job yang sama, anchor cadangan bergeser, Buat ulang).
 */
type StoreItem = {
  id: string; conversationId: string; kind: string; state: string; anchorAt: Date; anchorMessageId: string | null; snippet: string
  review: unknown; handoff: boolean; newLead: boolean; openedOn: string; lastSeenOn: string; reminderId: string | null
  dueAt: Date | null; closedReason: string | null; note: string | null; closedById: string | null; closedAt: Date | null
}
type StoreMsg = { id: string; conversationId: string; direction: 'INBOUND' | 'OUTBOUND'; sentBy: string; type: string; content: string; createdAt: Date }
type MsgWhere = { conversationId?: string; direction?: string; createdAt?: { gt?: Date; lte?: Date }; id?: { in: string[] } }

function useStore() {
  const st = {
    items: [] as StoreItem[],
    messages: [] as StoreMsg[],
    reminders: {} as Record<string, { id: string; done: boolean; dueAt: Date }>,
    chatReviewAt: null as Date | null,
  }
  const matches = (item: StoreItem, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, cond]) => {
      const value = (item as Record<string, unknown>)[key]
      if (cond && typeof cond === 'object' && 'in' in cond) return (cond as { in: unknown[] }).in.includes(value)
      return value === cond
    })
  beforeEach(() => {
    st.items = []
    st.messages = []
    st.reminders = {}
    st.chatReviewAt = null
    mockPrisma.summaryItem.findUnique.mockImplementation((async (a: { where: { conversationId: string } }) =>
      st.items.find((i) => i.conversationId === a.where.conversationId) ?? null) as never)
    mockPrisma.summaryItem.findMany.mockImplementation((async (a: { where: Record<string, unknown> }) => st.items.filter((i) => matches(i, a.where))) as never)
    mockPrisma.summaryItem.create.mockImplementation((async (a: { data: Partial<StoreItem> }) => {
      const created = { ...(row() as unknown as StoreItem), id: `i${st.items.length + 1}`, ...a.data }
      st.items.push(created)
      return created
    }) as never)
    mockPrisma.summaryItem.update.mockImplementation((async (a: { where: { id: string }; data: Partial<StoreItem> }) => {
      const target = st.items.find((i) => i.id === a.where.id)
      if (target) Object.assign(target, a.data)
      return target
    }) as never)
    mockPrisma.reminder.findUnique.mockImplementation((async (a: { where: { id: string } }) => st.reminders[a.where.id] ?? null) as never)
    mockPrisma.reminder.updateMany.mockImplementation((async (a: { where: { id: string } }) => {
      const r = st.reminders[a.where.id]
      if (r) r.done = true
      return { count: r ? 1 : 0 }
    }) as never)
    mockPrisma.conversation.findUnique.mockImplementation((async () => ({ pipelineStage: 'nego', chatReviewAt: st.chatReviewAt })) as never)
    mockPrisma.$transaction.mockImplementation((async (ops: unknown) => (Array.isArray(ops) ? Promise.all(ops) : ops)) as never)
    mockPrisma.message.findFirst.mockImplementation((async (a: { where: MsgWhere; orderBy: { createdAt: 'asc' | 'desc' } }) => {
      const { conversationId, direction, createdAt, id } = a.where
      const hits = st.messages
        .filter((m) => m.conversationId === conversationId)
        .filter((m) => direction === undefined || m.direction === direction)
        .filter((m) => !createdAt?.gt || m.createdAt > createdAt.gt)
        .filter((m) => !createdAt?.lte || m.createdAt <= createdAt.lte)
        .filter((m) => !id || id.in.includes(m.id))
        .sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime())
      return (a.orderBy?.createdAt === 'desc' ? hits.reverse() : hits)[0] ?? null
    }) as never)
  })
  const msg = (id: string, direction: StoreMsg['direction'], iso: string) =>
    st.messages.push({ id, conversationId: 'c1', direction, sentBy: direction === 'INBOUND' ? 'CUSTOMER' : 'AGENT', type: 'TEXT', content: id, createdAt: at(iso) })
  const snap = () => st.items.map((i) => `${i.kind}/${i.state}/${i.closedReason ?? '-'}`).join(',')
  return { st, msg, snap }
}

const rv = (janjiTim: unknown[]) => ({
  status: 'perlu_tindakan', alasan: 'a', jenisKontak: 'calon_tamu', topik: 't', pertanyaan: [], poinPenting: [], janjiTim, statusAgen: '', langkahBerikut: '',
}) as never
const pl = (review: unknown | null) =>
  payload({ conversations: (review ? [{ conversationId: 'c1', contactName: 'B', pipelineStage: 'nego', inbound: 1, outbound: 1, review }] : []) as never })
const unkeptId = rv([{ teks: 'Invoice besok', terpenuhi: false, messageId: 'janji' }])
const unkeptNoId = rv([{ teks: 'Invoice besok', terpenuhi: false }])
const keptId = rv([{ teks: 'Invoice besok', terpenuhi: true, messageId: 'janji' }])
/** Job malam untuk hari `day` (YYYY-MM-DD): sync lalu rekonsiliasi, 5 menit sesudah akhir hari WIB. */
async function nightly(day: string, review: unknown | null) {
  const { end } = jakartaDayRange(day)
  await syncSummaryItems(day, pl(review), new Date(end.getTime() + 5 * 60_000))
  await reconcileSummaryItems(new Date(end.getTime() + 6 * 60_000))
}

describe('janji tim (PROMISE): kandidat dan prioritas', () => {
  const { st, msg, snap } = useStore()

  it('janji terbuka pada percakapan yang bukan REPLY/FOLLOW_UP -> PROMISE, anchor + tautan = pesan janji', async () => {
    msg('janji', 'OUTBOUND', '2026-10-17T03:00:00Z')
    await nightly('2026-10-17', unkeptId)
    expect(st.items[0]).toMatchObject({ kind: 'PROMISE', state: 'OPEN', anchorAt: at('2026-10-17T03:00:00Z'), anchorMessageId: 'janji', snippet: 'Invoice besok' })
  })

  it('tanpa messageId: anchor = pesan OUTBOUND terakhir ≤ asOf, bukan akhir hari', async () => {
    msg('a', 'OUTBOUND', '2026-10-17T03:00:00Z')
    msg('b', 'OUTBOUND', '2026-10-17T06:00:00Z')
    msg('besok', 'OUTBOUND', '2026-10-18T01:00:00Z')
    await syncSummaryItems('2026-10-17', pl(unkeptNoId), at('2026-10-17T17:05:00Z'))
    expect(st.items[0]).toMatchObject({ kind: 'PROMISE', anchorAt: at('2026-10-17T06:00:00Z'), anchorMessageId: null })
  })

  it('tanpa messageId dan tanpa pesan keluar: anchor = asOf (dijepit ke now saat Buat ulang hari ini)', async () => {
    await syncSummaryItems('2026-10-18', pl(unkeptNoId), NOW)
    expect(st.items[0].anchorAt).toEqual(NOW)
  })

  it('janji string lama atau terpenuhi:true tidak membuat item', async () => {
    vi.mocked(console.error).mockClear()
    await syncSummaryItems('2026-10-18', pl(rv(['Invoice menyusul', { teks: 'Cek', terpenuhi: true }])), NOW)
    expect(st.items).toHaveLength(0)
    expect(console.error).not.toHaveBeenCalled()
  })

  it('REPLY menang: percakapan yang belum dibalas dan punya janji terbuka hanya jadi REPLY', async () => {
    const waiting = { ...unreplied('c1', '2026-10-18T05:00:00Z'), review: unkeptId }
    await syncSummaryItems('2026-10-18', payload({ unreplied: [waiting] as never, conversations: pl(unkeptId).conversations }), NOW)
    expect(snap()).toBe('REPLY/OPEN/-')
  })

  it('REPLY/FOLLOW_UP yang masih OPEN tidak diturunkan jadi PROMISE, lewat sync maupun Perbarui', async () => {
    for (const kind of ['REPLY', 'FOLLOW_UP']) {
      st.items = [{ ...(row({ kind, lastSeenOn: '2026-10-17' }) as unknown as StoreItem) }]
      msg('janji', 'OUTBOUND', '2026-10-17T03:00:00Z')
      await syncSummaryItems('2026-10-18', pl(unkeptId), NOW)
      await expect(applyReviewToItem('c1', unkeptId, NOW)).resolves.toBe('unchanged')
      expect(snap()).toBe(`${kind}/OPEN/-`)
    }
  })

  it('PROMISE yang OPEN berubah jadi REPLY bila percakapan itu kandidat REPLY', async () => {
    st.items = [{ ...(row({ kind: 'PROMISE', lastSeenOn: '2026-10-17' }) as unknown as StoreItem) }]
    await syncSummaryItems('2026-10-18', payload({ unreplied: [unreplied('c1', '2026-10-18T05:00:00Z')] as never }), NOW)
    expect(st.items[0]).toMatchObject({ kind: 'REPLY', anchorMessageId: 'm-c1' })
  })

  it('janji terbuka yang berganti: snippet, tautan, dan anchor ikut janji terbuka pertama', async () => {
    msg('janji', 'OUTBOUND', '2026-10-17T03:00:00Z')
    msg('itin', 'OUTBOUND', '2026-10-18T02:00:00Z')
    await nightly('2026-10-17', unkeptId)
    await nightly('2026-10-18', rv([{ teks: 'Invoice besok', terpenuhi: true, messageId: 'janji' }, { teks: 'Itinerary', terpenuhi: false, messageId: 'itin' }]))
    expect(st.items[0]).toMatchObject({ kind: 'PROMISE', state: 'OPEN', snippet: 'Itinerary', anchorMessageId: 'itin', anchorAt: at('2026-10-18T02:00:00Z'), lastSeenOn: '2026-10-18' })
  })
})

describe('janji tim (PROMISE): janji tidak hilang dan tidak bolak-balik', () => {
  const { st, msg, snap } = useStore()

  it('satu hari: janji, "ok ditunggu", "baik" sebelum job malam -> tetap PROMISE OPEN, juga malam berikutnya', async () => {
    msg('janji', 'OUTBOUND', '2026-10-17T03:00:00Z')
    msg('ok', 'INBOUND', '2026-10-17T04:00:00Z')
    msg('baik', 'OUTBOUND', '2026-10-17T05:00:00Z')
    await nightly('2026-10-17', unkeptId)
    expect(st.items[0]).toMatchObject({ kind: 'PROMISE', state: 'OPEN', anchorAt: at('2026-10-17T03:00:00Z') })
    await nightly('2026-10-18', null)
    expect(snap()).toBe('PROMISE/OPEN/-')
  })

  it('Perbarui lalu rekonsiliasi berulang -> tetap PROMISE OPEN', async () => {
    msg('janji', 'OUTBOUND', '2026-10-17T03:00:00Z')
    msg('ok', 'INBOUND', '2026-10-17T04:00:00Z')
    msg('baik', 'OUTBOUND', '2026-10-17T05:00:00Z')
    const outcomes: string[] = []
    for (const t of ['2026-10-17T06:00:00Z', '2026-10-17T06:10:00Z', '2026-10-17T06:20:00Z']) {
      st.chatReviewAt = at(t) // saveChatReview dengan asOf yang sama
      outcomes.push(await applyReviewToItem('c1', unkeptId, at(t)))
      await reconcileSummaryItems(at(t))
      expect(snap()).toBe('PROMISE/OPEN/-')
    }
    expect(outcomes).toEqual(['created', 'updated', 'updated'])
  })

  it('PROMISE → REPLY (pesan belum dibalas) → DONE/REPLIED → malam berikutnya PROMISE lagi, anchor tetap waktu janji', async () => {
    msg('janji', 'OUTBOUND', '2026-10-17T03:00:00Z')
    await nightly('2026-10-17', unkeptId)
    msg('ok', 'INBOUND', '2026-10-18T04:00:00Z')
    await reconcileSummaryItems(at('2026-10-18T04:30:00Z'))
    expect(st.items[0]).toMatchObject({ kind: 'REPLY', state: 'OPEN', anchorMessageId: 'ok' })
    msg('balasan', 'OUTBOUND', '2026-10-18T05:00:00Z')
    await reconcileSummaryItems(at('2026-10-18T05:30:00Z'))
    expect(snap()).toBe('REPLY/DONE/REPLIED')

    await nightly('2026-10-18', unkeptId)
    expect(st.items[0]).toMatchObject({ kind: 'PROMISE', state: 'OPEN', anchorAt: at('2026-10-17T03:00:00Z'), anchorMessageId: 'janji' })
    await nightly('2026-10-19', unkeptId)
    expect(snap()).toBe('PROMISE/OPEN/-')

    // Pesan pelanggan yang belum dibalas: barulah jadi REPLY.
    msg('tanya', 'INBOUND', '2026-10-20T01:00:00Z')
    await reconcileSummaryItems(at('2026-10-20T01:30:00Z'))
    expect(st.items[0]).toMatchObject({ kind: 'REPLY', state: 'OPEN', anchorMessageId: 'tanya' })
  })

  it('Lepas tanpa messageId: tidak dibuka lagi oleh sync maupun Perbarui walau ada pesan keluar baru', async () => {
    msg('janji', 'OUTBOUND', '2026-10-17T03:00:00Z')
    await nightly('2026-10-17', unkeptNoId)
    Object.assign(st.items[0], { state: 'DROPPED', closedReason: 'DROPPED', closedAt: at('2026-10-18T02:00:00Z') })
    msg('halo', 'OUTBOUND', '2026-10-18T03:00:00Z')
    await nightly('2026-10-18', unkeptNoId)
    st.chatReviewAt = at('2026-10-19T03:00:00Z')
    await expect(applyReviewToItem('c1', unkeptNoId, at('2026-10-19T03:00:00Z'))).resolves.toBe('unchanged')
    expect(snap()).toBe('PROMISE/DROPPED/DROPPED')
  })

  it('Lepas dengan messageId: janji yang sama tidak membukanya lagi; janji baru sesudahnya membuka', async () => {
    msg('janji', 'OUTBOUND', '2026-10-17T03:00:00Z')
    await nightly('2026-10-17', unkeptId)
    Object.assign(st.items[0], { state: 'DROPPED', closedReason: 'DROPPED', closedAt: at('2026-10-18T02:00:00Z') })
    await nightly('2026-10-18', unkeptId)
    st.chatReviewAt = at('2026-10-19T03:00:00Z')
    await expect(applyReviewToItem('c1', unkeptId, at('2026-10-19T03:00:00Z'))).resolves.toBe('unchanged')
    expect(snap()).toBe('PROMISE/DROPPED/DROPPED')

    msg('janji2', 'OUTBOUND', '2026-10-19T04:00:00Z')
    await nightly('2026-10-19', rv([{ teks: 'Voucher', terpenuhi: false, messageId: 'janji2' }]))
    expect(st.items[0]).toMatchObject({ kind: 'PROMISE', state: 'OPEN', anchorMessageId: 'janji2' })
  })

  it.each([
    ['dengan messageId', unkeptId],
    ['tanpa messageId', unkeptNoId],
  ])('Ingatkan → jatuh tempo → selesai (REMINDER_DONE) tidak dibuka lagi oleh janji yang sama (%s)', async (_label, review) => {
    msg('janji', 'OUTBOUND', '2026-10-17T03:00:00Z')
    await nightly('2026-10-17', review)
    st.reminders.r1 = { id: 'r1', done: false, dueAt: at('2026-10-18T02:00:00Z') }
    Object.assign(st.items[0], { state: 'SCHEDULED', reminderId: 'r1', dueAt: at('2026-10-18T02:00:00Z') })
    await reconcileSummaryItems(at('2026-10-18T02:30:00Z'))
    expect(snap()).toBe('PROMISE/OPEN/-')
    st.reminders.r1.done = true
    await reconcileSummaryItems(at('2026-10-18T03:00:00Z'))
    expect(snap()).toBe('PROMISE/DONE/REMINDER_DONE')
    await nightly('2026-10-18', review)
    expect(snap()).toBe('PROMISE/DONE/REMINDER_DONE')
  })

  it('LLM bergantian [] dan janji tanpa messageId: tetap PROMISE OPEN dengan anchor yang sama', async () => {
    msg('janji', 'OUTBOUND', '2026-10-17T03:00:00Z')
    const seq = [unkeptNoId, rv([]), unkeptNoId, rv([]), unkeptNoId]
    for (let d = 0; d < seq.length; d++) {
      msg(`lain${d}`, 'OUTBOUND', `2026-10-${17 + d}T09:00:00Z`)
      await nightly(`2026-10-${17 + d}`, seq[d])
      expect(snap()).toBe('PROMISE/OPEN/-')
      expect(st.items[0].anchorAt).toEqual(at('2026-10-17T09:00:00Z'))
    }
  })

  it('messageId hilang satu malam: anchor dan tautan baris tetap', async () => {
    msg('janji', 'OUTBOUND', '2026-10-17T03:00:00Z')
    for (const [d, review] of [unkeptId, unkeptNoId, unkeptId].entries()) {
      msg(`lain${d}`, 'OUTBOUND', `2026-10-${17 + d}T09:00:00Z`)
      await nightly(`2026-10-${17 + d}`, review)
      expect(st.items[0]).toMatchObject({ kind: 'PROMISE', state: 'OPEN', anchorAt: at('2026-10-17T03:00:00Z'), anchorMessageId: 'janji' })
    }
  })
})

describe('janji tim (PROMISE): ringkasan tanggal lama dan penutupan', () => {
  const { st, msg, snap } = useStore()

  it('Buat ulang tanggal lama tidak membuka DONE/REPLIED yang sudah dinilai review lebih baru', async () => {
    st.items = [{
      ...(row() as unknown as StoreItem), kind: 'REPLY', state: 'DONE', closedReason: 'REPLIED', anchorAt: at('2026-10-15T10:00:00Z'),
      closedAt: at('2026-10-16T05:00:00Z'), lastSeenOn: '2026-10-15', openedOn: '2026-10-15',
    }]
    msg('janji', 'OUTBOUND', '2026-10-16T05:00:00Z')
    st.chatReviewAt = jakartaDayRange('2026-10-17').end // job malam 17: janji ditepati
    await syncSummaryItems('2026-10-17', pl(keptId), at('2026-10-17T17:05:00Z'))
    await syncSummaryItems('2026-10-16', pl(unkeptId), at('2026-10-19T03:00:00Z'))
    expect(snap()).toBe('REPLY/DONE/REPLIED')
    // Review terbaru yang sama-sama belum ditepati tetap membukanya.
    st.chatReviewAt = jakartaDayRange('2026-10-18').end
    await syncSummaryItems('2026-10-18', pl(unkeptId), at('2026-10-18T17:05:00Z'))
    expect(snap()).toBe('PROMISE/OPEN/-')
  })

  it('Buat ulang tanggal lama tidak menimpa review item PROMISE yang terbuka', async () => {
    msg('janji', 'OUTBOUND', '2026-10-15T03:00:00Z')
    await nightly('2026-10-15', unkeptId)
    st.chatReviewAt = jakartaDayRange('2026-10-17').end
    msg('lain', 'OUTBOUND', '2026-10-16T03:00:00Z')
    await syncSummaryItems('2026-10-16', pl(rv([{ teks: 'Lain', terpenuhi: false, messageId: 'lain' }])), at('2026-10-19T03:00:00Z'))
    expect(st.items[0]).toMatchObject({ anchorMessageId: 'janji', snippet: 'Invoice besok', lastSeenOn: '2026-10-15' })
  })

  it('review yang tidak lagi menyebut janjinya membiarkan item OPEN dan tidak menimpa review-nya', async () => {
    msg('janji', 'OUTBOUND', '2026-10-17T03:00:00Z')
    await nightly('2026-10-17', unkeptId)
    await nightly('2026-10-18', rv([]))
    expect(snap()).toBe('PROMISE/OPEN/-')
    expect(st.items[0].review).toEqual(unkeptId)
    // Hanya sebagian yang ditepati: tetap terbuka.
    st.items[0].review = rv([{ teks: 'Invoice besok', terpenuhi: false, messageId: 'janji' }, { teks: 'Cek jeep', terpenuhi: false }])
    await nightly('2026-10-19', keptId)
    expect(snap()).toBe('PROMISE/OPEN/-')
  })

  it('setiap janji yang dilacak eksplisit terpenuhi -> DONE/PROMISE_KEPT, closedAt = akhir hari, pengingat selesai', async () => {
    msg('janji', 'OUTBOUND', '2026-10-17T03:00:00Z')
    await nightly('2026-10-17', unkeptId)
    st.reminders.r1 = { id: 'r1', done: false, dueAt: at('2026-10-25T02:00:00Z') }
    Object.assign(st.items[0], { state: 'SCHEDULED', reminderId: 'r1' })
    await nightly('2026-10-18', keptId)
    expect(st.items[0]).toMatchObject({ state: 'DONE', closedReason: 'PROMISE_KEPT', closedAt: jakartaDayRange('2026-10-18').end, lastSeenOn: '2026-10-18' })
    expect(st.reminders.r1.done).toBe(true)
  })

  it('cocok lewat teks bila salah satu tanpa messageId', async () => {
    await nightly('2026-10-17', unkeptNoId)
    await nightly('2026-10-18', rv([{ teks: '  invoice   BESOK ', terpenuhi: true }]))
    expect(snap()).toBe('PROMISE/DONE/PROMISE_KEPT')
  })

  it('Perbarui: tutup PROMISE_KEPT dengan closedAt = asOf dan lastSeenOn naik ke hari asOf', async () => {
    msg('janji', 'OUTBOUND', '2026-10-17T03:00:00Z')
    await nightly('2026-10-17', unkeptId)
    st.chatReviewAt = at('2026-10-19T02:00:00Z')
    await expect(applyReviewToItem('c1', keptId, at('2026-10-19T02:00:00Z'))).resolves.toBe('closed')
    expect(st.items[0]).toMatchObject({ state: 'DONE', closedReason: 'PROMISE_KEPT', closedAt: at('2026-10-19T02:00:00Z'), lastSeenOn: '2026-10-19' })
  })

  it('Perbarui: membuat PROMISE dari kosong dan membuka lagi DONE/REPLIED', async () => {
    msg('janji', 'OUTBOUND', '2026-10-18T03:00:00Z')
    st.chatReviewAt = NOW
    await expect(applyReviewToItem('c1', unkeptId, NOW)).resolves.toBe('created')
    expect(st.items[0]).toMatchObject({ kind: 'PROMISE', state: 'OPEN', anchorMessageId: 'janji', openedOn: '2026-10-18', lastSeenOn: '2026-10-18' })
    Object.assign(st.items[0], { kind: 'REPLY', state: 'DONE', closedReason: 'REPLIED', closedAt: at('2026-10-18T05:00:00Z') })
    await expect(applyReviewToItem('c1', unkeptId, NOW)).resolves.toBe('reopened')
    expect(snap()).toBe('PROMISE/OPEN/-')
  })

  it('Perbarui: tanpa item dan tanpa janji terbuka -> unchanged; error -> unchanged, tidak melempar', async () => {
    await expect(applyReviewToItem('c1', rv([]), NOW)).resolves.toBe('unchanged')
    expect(st.items).toHaveLength(0)
    mockPrisma.summaryItem.findUnique.mockRejectedValue(new Error('db down'))
    await expect(applyReviewToItem('c1', unkeptId, NOW)).resolves.toBe('unchanged')
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

    it('inbound yang sudah dibalas (sebelum pesan keluar terakhir) tidak mengubahnya jadi REPLY', async () => {
      mockPrisma.summaryItem.findMany.mockResolvedValue([row({ kind: 'PROMISE' })] as never)
      const lastOut = at('2026-10-18T05:00:00Z')
      mockPrisma.message.findFirst.mockImplementation((async (a: { where: { direction: string; createdAt?: { gt: Date } } }) => {
        if (a.where.direction === 'OUTBOUND') return { id: 'o1', createdAt: lastOut }
        return a.where.createdAt && a.where.createdAt.gt < inbound.createdAt ? inbound : null
      }) as never)
      const r = await reconcileSummaryItems(NOW)
      expect(r.converted).toBe(0)
      const inboundQuery = mockPrisma.message.findFirst.mock.calls.map((c) => c[0] as { where: { direction: string; createdAt: unknown } }).find((q) => q.where.direction === 'INBOUND')
      expect(inboundQuery?.where.createdAt).toEqual({ gt: lastOut })
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

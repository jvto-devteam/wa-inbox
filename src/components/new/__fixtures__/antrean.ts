// Fixture test: jawaban GET /api/summary-items dan /api/new/reminders tiruan untuk menu Antrean /new.
import { vi } from 'vitest'
import type { SummaryItemsResponse } from '@/app/api/summary-items/route'
import type { NewReminder } from '@/app/api/new/reminders/route'
import type { SummaryItemView } from '@/lib/summary-items/view'
import { review } from './summary'

const H = 3600e3
const item = (id: string, kind: SummaryItemView['kind'], name: string, hoursAgo: number, o: Partial<SummaryItemView> = {}): SummaryItemView => ({
  id, conversationId: 'c-' + id, contactName: name, pipelineStage: 'new', kind, state: 'OPEN',
  anchorAt: new Date(Date.now() - hoursAgo * H).toISOString(), anchorMessageId: 'm-' + id, snippet: 'Pesan ' + name,
  review: null, handoff: false, newLead: false, openedOn: '2026-11-24', dueAt: null, ...o,
})

export function sampleQueue(): { items: SummaryItemsResponse; reminders: NewReminder[] } {
  return {
    items: {
      open: [
        item('a', 'REPLY', 'Sarah M.', 3, { snippet: 'Bisa jemput jam 5?', review: review({ langkahBerikut: 'Konfirmasi jam jemput 05.00' }) }),
        item('b', 'REPLY', 'Ben C.', 1),
        item('c', 'FOLLOW_UP', 'Tom W.', 72),
        item('d', 'PROMISE', 'Rina K.', 30, { snippet: 'Kirim invoice' }),
      ],
      scheduled: [],
      openGapTotal: 0,
    },
    reminders: [
      { id: 'r1', note: 'Cek mutasi pembayaran', dueAt: new Date(Date.now() + 5 * H).toISOString(), contactId: 'k1', contactName: 'Mei H.', conversationId: 'c-r1', summaryItemId: null },
      { id: 'r2', note: 'Follow-up: kirim harga', dueAt: new Date(Date.now() - H).toISOString(), contactId: 'k2', contactName: 'Hana Y.', conversationId: null, summaryItemId: 'i9' },
    ],
  }
}

/** Stub fetch Antrean; tulis (schedule/drop/PATCH reminder) menjawab ok. */
export function stubQueueFetch(q = sampleQueue()) {
  const fn = vi.fn(async (input: string, init?: RequestInit) => {
    const path = new URL(input, 'http://x').pathname
    const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response
    if (path === '/api/summary-items') return ok(q.items)
    if (path === '/api/new/reminders') return ok({ reminders: q.reminders })
    if (init?.method && /^\/api\/(summary-items\/[^/]+\/(schedule|drop)|contacts\/[^/]+\/reminders)$/.test(path)) return ok({ ok: true })
    return { ok: false, status: 404, json: async () => ({ error: 'tidak ada' }) } as Response
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

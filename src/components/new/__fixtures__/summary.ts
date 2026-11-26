// Fixture test: jawaban GET /api/daily-summary tiruan untuk menu Ringkasan /new.
import { vi } from 'vitest'
import type { DailySummaryResponse } from '@/app/api/daily-summary/route'
import type { ConversationReview } from '@/lib/daily-summary/payload-schema'

export const review = (o: Partial<ConversationReview> = {}): ConversationReview => ({
  status: 'selesai', alasan: 'Sudah dijawab', jenisKontak: 'calon_tamu', topik: 'harga', pertanyaan: [], poinPenting: [],
  janjiTim: [], profil: [], statusAgen: '', langkahBerikut: '', ...o,
})

export function sampleSummary(): DailySummaryResponse {
  const ref = (id: string, name: string | null) => ({ conversationId: id, contactName: name, pipelineStage: 'new' })
  return {
    dates: [{ date: '2026-11-24', status: 'DONE' }, { date: '2026-11-23', status: 'PARTIAL' }],
    summary: {
      date: '2026-11-24', status: 'DONE', model: 'm', startedAt: '2026-11-24T17:00:00.000Z', finishedAt: '2026-11-24T17:04:00.000Z', error: null,
      payload: {
        version: 1, date: '2026-11-24', windowStart: '', windowEnd: '', generatedAt: '',
        thresholds: { unrepliedMinMs: 0, dormantMinMs: 0, lookbackMs: 0 },
        counts: { activeConversations: 9, inbound: 0, outbound: 0, newConversations: 0, reviewed: 3, reviewFailed: 0 },
        filteredOut: { unreplied: 0, dormant: 0 },
        unreplied: [{ ...ref('c2', 'Lukas B.'), lastMessageAt: '', waitingMs: 0, snippet: '', review: review({
          status: 'perlu_tindakan', langkahBerikut: 'Minta maaf dan tawarkan jemput ulang',
          pertanyaan: [{ teks: 'Kapan sopir datang?', terjawab: false }],
          poinPenting: [{ teks: 'Sopir telat 1 jam di hotel', jenis: 'komplain', messageId: 'm7' }],
        }) }],
        dormant: [],
        newLeads: [],
        handoffs: [],
        gaps: { newCount: 0, openTotal: 0, byReason: [], byTopic: [], items: [] },
        conversations: [
          { ...ref('c1', 'Emma R.'), inbound: 3, outbound: 2, review: review({
            poinPenting: [{ teks: 'Jemput di Ketapang jam 06.00', jenis: 'jemput' }, 'Poin lama tanpa jenis'],
            janjiTim: [{ teks: 'Kirim invoice', terpenuhi: false }, { teks: 'Cek kamar', terpenuhi: true }],
            // tanpa langkahBerikut: saran memakai rekomendasi follow-up lead
            belumBooking: { alasan: 'menunggu_tim', teks: 'Menunggu invoice', rekomendasi: 'Kirim invoice hari ini' },
          }) },
          // c2 (Lukas) hanya kandidat belum dibalas: tidak ada pesan hari itu = masih menggantung
          { ...ref('c3', null), inbound: 1, outbound: 0, review: null },
        ],
      },
    },
    // c1: review "selesai", tetapi janji masih OPEN di antrean live → perlu tindakan
    items: { c1: { id: 'i1', kind: 'PROMISE', state: 'OPEN', dueAt: null, closedReason: null, note: null, closedAt: null } },
    hidden: {},
    // Sengaja beda dari jumlah janji belum ditepati di review (1): angka ini datang dari antrean live (AR-04).
    openPromises: 3,
  }
}

/** Stub fetch: /api/daily-summary menjawab sampleSummary, /api/session sebagai `role`; route lain 404. */
export function stubSummaryFetch(res: DailySummaryResponse = sampleSummary(), role = 'ADMIN') {
  const fn = vi.fn(async (input: string, init?: RequestInit) => {
    const path = new URL(input, 'http://x').pathname
    const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response
    if (path === '/api/daily-summary') return ok(res)
    if (path === '/api/session') return ok({ role })
    if (path === '/api/daily-summary/generate' && init?.method === 'POST') return ok({ date: '2026-11-24', status: 'DONE' })
    if (/^\/api\/summary-items\/[^/]+\/(schedule|drop)$/.test(path) && init?.method === 'POST') return ok({ ok: true })
    return { ok: false, status: 404, json: async () => ({ error: 'tidak ada' }) } as Response
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

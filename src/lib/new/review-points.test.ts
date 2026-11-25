/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import type { ConversationReview } from '@/lib/daily-summary/payload-schema'
import { indexPointCounts, previousPointCount } from './review-points'

const rev = (n: number): ConversationReview => ({
  status: 'perlu_tindakan', alasan: 'a', jenisKontak: 'calon_tamu', topik: 't', pertanyaan: [],
  poinPenting: Array.from({ length: n }, (_, i) => 'poin ' + i), janjiTim: [], profil: [], statusAgen: '', langkahBerikut: '',
})
const ref = (conversationId: string) => ({ conversationId, contactName: 'Budi', pipelineStage: 'NEW' })
const conv = (id: string, review: ConversationReview | null) => ({ ...ref(id), inbound: 1, outbound: 0, review })
function payload(date: string, parts: Record<string, unknown[]>) {
  return {
    version: 1, date, windowStart: 'a', windowEnd: 'b', generatedAt: 'c',
    thresholds: { unrepliedMinMs: 1, dormantMinMs: 1, lookbackMs: 1 },
    counts: { activeConversations: 0, inbound: 0, outbound: 0, newConversations: 0, reviewed: 0, reviewFailed: 0 },
    filteredOut: { unreplied: 0, dormant: 0 },
    unreplied: [], dormant: [], newLeads: [], handoffs: [],
    gaps: { newCount: 0, openTotal: 0, byReason: [], byTopic: [], items: [] },
    conversations: [],
    ...parts,
  }
}

describe('previousPointCount', () => {
  const index = indexPointCounts([
    { date: '2026-11-24', payload: payload('2026-11-24', { conversations: [conv('a', rev(4)), conv('b', null)] }) },
    { date: '2026-11-23', payload: { rusak: true } },
    { date: '2026-11-22', payload: payload('2026-11-22', { conversations: [conv('b', rev(2))], unreplied: [{ ...ref('c'), lastMessageAt: 'x', waitingMs: 1, snippet: 's', review: rev(0) }] }) },
  ])

  it('mengambil ringkasan harian terakhir SEBELUM hari pembaruan', () => {
    expect(previousPointCount(index, 'a', '2026-11-25')).toBe(4)
    // ringkasan harian hari itu sendiri adalah pembaruan yang sedang dinilai, bukan pembandingnya
    expect(previousPointCount(index, 'a', '2026-11-24')).toBeNull()
  })

  it('melewati review null dan payload rusak; bagian unreplied juga dihitung', () => {
    expect(previousPointCount(index, 'b', '2026-11-25')).toBe(2)
    expect(previousPointCount(index, 'c', '2026-11-25')).toBe(0)
  })

  it('null bila percakapan belum pernah diringkas', () => {
    expect(previousPointCount(index, 'zz', '2026-11-25')).toBeNull()
  })
})

// Menu Ringkasan /new: DATA ASLI dari GET /api/daily-summary (rute yang sama dengan /summary).
// Fungsi murni: payload ringkasan harian → poin penting per jenis + daftar per percakapan.
import type { DailySummaryResponse } from '@/app/api/daily-summary/route'
import type { SummaryItemStatus } from '@/lib/summary-items/status'
import {
  normalizePoint,
  normalizeQuestion,
  POINT_KINDS,
  unkeptPromises,
  type ConversationReview,
  type PointKind,
} from '@/lib/daily-summary/payload-schema'

export interface SummaryPoint {
  kind: PointKind | null
  name: string
  text: string
  conversationId: string
  /** Pesan sumber; tautan Inbox menyorotnya bila ada. */
  messageId: string | null
}

export interface SummaryChat {
  conversationId: string
  name: string
  /** Status SEKARANG: item antrean live bila ada, selain itu penilaian review hari itu. */
  open: boolean
  lines: string[]
  /** Saran tindakan berikutnya dari AI; hanya selama percakapan masih perlu tindakan. */
  saran: string | null
  /** Item antrean live (Ingatkan/Lepas memakai id-nya); null = tidak pernah masuk antrean. */
  item: SummaryItemStatus | null
  /** Ada pesan pada hari itu; false = masih menggantung (belum dibalas/diam) tanpa pesan baru. */
  active: boolean
}

export interface SummaryDay {
  date: string
  status: string
  finishedAt: string | null
  error: string | null
  active: number
  points: SummaryPoint[]
  /** Janji tim yang menurut review hari itu belum ditepati. */
  unkept: number
  chats: SummaryChat[]
}

/** Href Inbox untuk satu percakapan, opsional menyorot pesan. */
export function chatHref(conversationId: string, messageId?: string | null): string {
  return '/inbox?conversation=' + encodeURIComponent(conversationId) + (messageId ? '&message=' + encodeURIComponent(messageId) : '')
}

const RANK = (k: PointKind | null) => (k ? POINT_KINDS.indexOf(k) : POINT_KINDS.length)

export function summaryDay(res: DailySummaryResponse): SummaryDay | null {
  const s = res.summary
  if (!s) return null
  const p = s.payload
  // Satu percakapan bisa muncul di beberapa daftar; review pertama yang ada yang dipakai.
  const seen = new Map<string, { name: string; review: ConversationReview }>()
  if (p) {
    for (const list of [p.conversations, p.unreplied, p.dormant, p.newLeads]) {
      for (const e of list) {
        if (!e.review || seen.has(e.conversationId)) continue
        seen.set(e.conversationId, { name: e.contactName || 'Tanpa nama', review: e.review })
      }
    }
  }
  const activeIds = new Set(p?.conversations.map((c) => c.conversationId) ?? [])
  const points: SummaryPoint[] = []
  const chats: SummaryChat[] = []
  let unkept = 0
  for (const [conversationId, { name, review }] of seen) {
    for (const raw of review.poinPenting) {
      const pt = normalizePoint(raw)
      points.push({ kind: pt.jenis, name, text: pt.teks, conversationId, messageId: pt.messageId })
    }
    const promises = unkeptPromises(review)
    unkept += promises.length
    const item = res.items[conversationId] ?? null
    const open = item ? item.state === 'OPEN' || item.state === 'SCHEDULED' : review.status === 'perlu_tindakan'
    const lines = [
      ...review.pertanyaan.map(normalizeQuestion).filter((q) => q.terjawab === false).map((q) => '❓ ' + q.teks),
      ...promises.map((x) => '⏳ ' + x.teks),
    ]
    // Langkah berikut dulu; calon tamu tanpa itu memakai rekomendasi follow-up "belum booking".
    const saran = open ? review.langkahBerikut.trim() || review.belumBooking?.rekomendasi.trim() || null : null
    chats.push({ conversationId, name, open, lines: lines.length || saran ? lines : [review.alasan || review.topik || 'Tidak ada catatan.'], saran, item, active: activeIds.has(conversationId) })
  }
  // Urutan jenis = prioritas (komplain dulu); dalam satu jenis urutan payload dipertahankan.
  points.sort((a, b) => RANK(a.kind) - RANK(b.kind))
  // Aktif hari itu dulu, lalu yang menggantung; di dalamnya yang perlu tindakan dulu.
  chats.sort((a, b) => Number(b.active) - Number(a.active) || Number(b.open) - Number(a.open))
  return {
    date: s.date,
    status: s.status,
    finishedAt: s.finishedAt,
    error: s.error,
    active: p?.counts.activeConversations ?? 0,
    points,
    unkept,
    chats,
  }
}

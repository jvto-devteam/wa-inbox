/**
 * Web Push "komplain / ada masalah" (owner 2026-11-27). Sumbernya label profil ringkasan AI chat (`review.profil`):
 * komplain, keselamatan, mendesak, refund_batal, kendala_bayar. Dipanggil `saveChatReview` sesudah ringkasan baru
 * tersimpan, jadi terkirim begitu ringkasan dibuat (otomatis 30 dtk–5 menit sesudah pesan, tombol Perbarui, job 00:00).
 *
 * Satu push per label yang BARU muncul dibanding ringkasan sebelumnya. Label yang sudah ada di ringkasan sebelumnya
 * tidak dikabarkan lagi walau bukti pesannya bergeser (LLM bisa menunjuk pesan lain tiap putaran); label yang sempat
 * hilang lalu muncul lagi dikabarkan lagi. Isi: label + nama kontak, tanpa teks pesan. Tidak pernah melempar.
 */
import { PROFILE_LABEL_TEXT, type ConversationReview, type ProfileLabel } from '@/lib/daily-summary/payload-schema'
import { armCallEscalation } from '@/lib/call-escalation/escalate'
import { scrub, sendPushToAll, type PushPayload } from './send'

export const PROBLEM_LABELS: readonly ProfileLabel[] = ['keselamatan', 'komplain', 'mendesak', 'refund_batal', 'kendala_bayar']

function labelsOf(review: unknown): Set<string> {
  const profil = review && typeof review === 'object' ? (review as { profil?: unknown }).profil : undefined
  if (!Array.isArray(profil)) return new Set()
  return new Set(profil.map((p) => (p && typeof p === 'object' ? (p as { label?: unknown }).label : undefined)).filter((l): l is string => typeof l === 'string'))
}

/** Label masalah di ringkasan baru (urut prioritas), beserta pesan buktinya. */
export function problemsOf(review: ConversationReview): { label: ProfileLabel; messageId: string }[] {
  return PROBLEM_LABELS.flatMap((label) => {
    const hit = review.profil.find((p) => p.label === label)
    return hit ? [{ label, messageId: hit.messageId }] : []
  })
}

export function buildProblemPayload(p: { conversationId: string; label: ProfileLabel; messageId: string; contactName: string | null }): PushPayload {
  const name = p.contactName?.trim() ? scrub(p.contactName.trim()).slice(0, 60) : 'Pelanggan'
  const params = new URLSearchParams({ conversation: p.conversationId, message: p.messageId })
  return {
    title: `${PROFILE_LABEL_TEXT[p.label]}: ${name}`,
    body: 'Ringkasan AI menandai masalah di chat ini — ketuk untuk melihat',
    url: `/inbox?${params}`,
    tag: `problem:${p.conversationId}:${p.label}`,
  }
}

export async function notifyNewProblems(conversationId: string, previousReview: unknown, review: ConversationReview, contactName: string | null): Promise<number> {
  try {
    const before = labelsOf(previousReview)
    const fresh = problemsOf(review).filter((p) => !before.has(p.label))
    for (const p of fresh) {
      await sendPushToAll(buildProblemPayload({ conversationId, ...p, contactName }))
      // Eskalasi telepon (owner 2026-11-27): 15 menit tanpa pesan keluar agen = admin ditelepon. Tidak pernah melempar.
      await armCallEscalation({ kind: 'PROBLEM', conversationId, label: p.label })
    }
    return fresh.length
  } catch {
    console.error('notifyNewProblems gagal')
    return 0
  }
}

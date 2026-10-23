/**
 * Kantor AI (`/ai-office`, owner 2026-10-23): papan live tempat tim melihat asisten AI yang sedang bekerja. Modul ini
 * hanya MENYIARKAN kegiatan; ia tidak pernah mengubah apa yang dikerjakan asisten itu. Setiap panggilan dibungkus
 * try/catch dan tidak pernah melempar -- papan yang bolong jauh lebih murah daripada balasan, ringkasan, atau perubahan
 * booking yang gagal karena siaran (aturan yang sama dengan pipeline/tracer.ts).
 *
 * Bot balasan TIDAK memakai event ini untuk membalas tamu: kegiatannya sudah disiarkan per langkah sebagai `pipeline.step`.
 * Event ini dipakai bot hanya saat operator mengobrol dengannya di Kantor AI (`agent-chat.ts`).
 */
import { broadcast } from '@/lib/realtime'

/** Asisten AI yang punya meja di Kantor AI. `bot` digerakkan terutama oleh `pipeline.step`, sisanya oleh `ai.activity`. */
export const AI_AGENTS = ['topik', 'bot', 'booking', 'ringkasan'] as const
export type AiAgentKey = (typeof AI_AGENTS)[number]
export type AiActivityState = 'mulai' | 'selesai' | 'gagal'

/** Siarkan satu kegiatan. `label` = kalimat pendek untuk balon status, tanpa isi chat atau data pribadi. */
export function reportAiActivity(
  agent: AiAgentKey,
  state: AiActivityState,
  label: string,
  /** Kosong bila kegiatannya bukan untuk satu chat (obrolan operator). */
  conversationId: string,
  /** `selesai` yang menghasilkan sesuatu untuk admin (ringkasan baru, perubahan booking): karakter mengantarnya ke meja admin. */
  deliver = false
): void {
  try {
    broadcast({ type: 'ai.activity', agent, state, label, conversationId, at: new Date().toISOString(), ...(deliver ? { deliver: true } : {}) })
  } catch (error) {
    console.error('ai-office: siaran gagal', { agent, error: error instanceof Error ? error.name : 'unknown' })
  }
}

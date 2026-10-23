/**
 * Logika status Kantor AI, murni (tanpa React/DOM) supaya bisa dites. Menerjemahkan event SSE ke keadaan satu meja:
 * - `pipeline.step` (bot balasan) -> label langkah dari steps.ts;
 * - `ai.activity` (label topik, aksi booking, ringkasan chat).
 * Mode: `idle` (menunggu), `working` (mengetik), `done` (selesai di meja), `handoff` (berjalan ke meja admin
 * mengantar hasil), `error`.
 */
import { findStepBySubStepId, getPipelineStep } from '@/lib/pipeline/steps'
import type { AiAgentKey } from './activity'

export type AgentMode = 'idle' | 'working' | 'done' | 'handoff' | 'error'
export type AgentLive = { mode: AgentMode; label: string; conversationId: string | null; at: string }

export type OfficeEvent =
  | { type: 'pipeline.step'; conversationId: string; stepId: string; status: string; at: string }
  | { type: 'ai.activity'; agent: Exclude<AiAgentKey, 'bot'>; state: 'mulai' | 'selesai' | 'gagal'; label: string; conversationId: string; at: string; deliver?: boolean }

export const IDLE_LABEL: Record<AiAgentKey, string> = {
  topik: 'Menunggu pesan masuk',
  bot: 'Siap membalas tamu',
  booking: 'Memantau permintaan booking',
  ringkasan: 'Siap meringkas chat',
}

/** Berapa lama sebuah keadaan bertahan sebelum kembali `idle` (ms). `working` tanpa kabar lanjutan juga dianggap usai. */
export const MODE_TTL_MS: Record<AgentMode, number> = { idle: 0, working: 120_000, done: 6_000, handoff: 6_500, error: 8_000 }

function stepLabel(stepId: string): string {
  return (getPipelineStep(stepId) ?? findStepBySubStepId(stepId))?.label ?? 'Memproses pesan'
}

/** Satu event -> pembaruan satu meja, atau null bila event itu bukan urusan Kantor AI. */
export function agentUpdateFromEvent(e: OfficeEvent): { agent: AiAgentKey; live: AgentLive } | null {
  if (e.type === 'ai.activity') {
    const mode: AgentMode = e.state === 'mulai' ? 'working' : e.state === 'gagal' ? 'error' : e.deliver ? 'handoff' : 'done'
    return { agent: e.agent, live: { mode, label: e.label, conversationId: e.conversationId, at: e.at } }
  }
  // Ekstraksi booking di jalur samping dilaporkan sendiri lewat `ai.activity` -- jangan ditampilkan dua kali.
  if (e.stepId === 'ekstrak-booking') return null
  const base = { conversationId: e.conversationId, at: e.at }
  if (e.status === 'gagal') return { agent: 'bot', live: { mode: 'error', label: 'Gagal memproses pesan', ...base } }
  if (e.stepId === 'serahkan-agen' || e.stepId === 'handoff-alert') {
    return { agent: 'bot', live: { mode: 'handoff', label: 'Menyerahkan chat ke admin', ...base } }
  }
  if ((e.stepId === 'kirim-balasan' || e.stepId === 'unofficial-send' || e.stepId === 'official-template-send') && e.status === 'selesai') {
    return { agent: 'bot', live: { mode: 'done', label: 'Balasan terkirim ke tamu', ...base } }
  }
  if (e.status === 'berhenti') return { agent: 'bot', live: { mode: 'done', label: 'Tidak perlu dibalas bot', ...base } }
  return { agent: 'bot', live: { mode: 'working', label: stepLabel(e.stepId), ...base } }
}

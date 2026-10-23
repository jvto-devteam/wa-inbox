import type { AiAgentKey } from './activity'

/**
 * Kontrak obrolan Kantor AI, dipakai bersama klien (`AgentChatPanel`) dan server (`/api/ai-office/chat` dan
 * `/api/ai-office/action`). Tidak ada impor server di sini supaya aman masuk bundel klien.
 */

export type AgentChatRole = 'user' | 'assistant'
export type AgentChatMessage = { role: AgentChatRole; content: string }

/** Usulan tindakan dari asisten. Tidak pernah dijalankan oleh LLM; operator menekan "Jalankan" lebih dulu. */
export type AgentProposal = { action: string; args: Record<string, unknown>; summary: string }

export type AgentChatResponse = {
  reply: string
  proposal: AgentProposal | null
  /** Label alat baca yang dipakai untuk menjawab (ditampilkan kecil di bawah jawaban). */
  used: string[]
}

export type AgentActionResponse = { result: string; conversationId?: string | null }

export const CHAT_MAX_MESSAGES = 20
export const CHAT_MAX_CHARS = 2000

export const AGENT_SUGGESTIONS: Record<AiAgentKey, string[]> = {
  topik: ['Topik apa yang paling banyak hari ini?', 'Label ulang topik chat terakhir', 'Chat mana saja yang membahas refund?'],
  bot: ['Berapa balasan bot hari ini?', 'Chat mana yang diserahkan ke admin hari ini?', 'Coba jawab: "Is Ijen open next week?"'],
  booking: ['Kartu booking apa yang masih terbuka?', 'Cek booking JVTO-3752', 'Perubahan apa yang diterapkan otomatis hari ini?'],
  ringkasan: ['Chat mana yang belum dibalas?', 'Janji tim apa yang belum ditepati?', 'Ringkas ulang chat terakhir'],
}

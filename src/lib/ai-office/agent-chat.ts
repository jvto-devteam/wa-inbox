import { prisma } from '@/lib/db'
import { callLLM } from '@/lib/bot/llm'
import { reportAiActivity, type AiAgentKey } from '@/lib/ai-office/activity'
import { AGENT_PROFILES, ALL_ACTIONS, ALL_TOOLS, findAction, findTool, type ToolCtx } from '@/lib/ai-office/agent-tools'
import type { AgentChatMessage, AgentChatResponse, AgentProposal } from '@/lib/ai-office/chat-types'

/**
 * Obrolan operator dengan satu asisten Kantor AI. Protokol JSON sederhana (model Ollama tidak dijamin mendukung
 * tool-calling): setiap giliran model mengeluarkan SATU objek --
 *   {"alat":"nama","args":{...}}                              minta data; server menjalankan alat baca lalu bertanya lagi
 *   {"jawab":"teks"}                                          jawaban akhir
 *   {"jawab":"teks","usul":{"aksi":"nama","args":{...}}}      jawaban + usulan tindakan (TIDAK dijalankan di sini)
 * Maksimal `MAX_TOOL_STEPS` alat per pertanyaan. Keluaran yang bukan JSON dianggap jawaban polos.
 */

export const MAX_TOOL_STEPS = 4
const CHAT_TIMEOUT_MS = 45_000
const TOOL_RESULT_MAX_CHARS = 6000

const TEAMMATES = 'Cahyo (label topik pesan), Tarjo (bot balasan tamu), Samsul (kartu & data booking), Asep (ringkasan chat & antrean tindak lanjut)'

export function buildAgentSystemPrompt(agent: AiAgentKey, now: Date): string {
  const p = AGENT_PROFILES[agent]
  const today = now.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  return [
    `Kamu adalah ${p.name}, ${p.role} di wa-inbox milik Java Volcano Tour Operator (JVTO). Kamu sedang mengobrol dengan operator internal JVTO, bukan tamu.`,
    `Bidangmu: ${p.scope}`,
    `Rekan satu kantor: ${TEAMMATES}.`,
    'Kamu boleh membaca semua data dan menerima perintah apa pun di daftar aksi. Setiap aksi punya PENGERJA; kalau pengerjanya rekanmu, tetap usulkan aksinya dan katakan bahwa kamu akan meminta rekan itu mengerjakannya (mis. "Aku minta Samsul mengubahnya").',
    `Sekarang: ${today} WIB.`,
    'Aturan:',
    '- Bahasa Indonesia, singkat, ramah, seperti rekan kerja. Boleh daftar pendek.',
    '- Angka, nama, dan status HANYA dari hasil alat. Jangan mengarang. Kalau data tidak ada, katakan.',
    '- Untuk chat tertentu, cari dulu id-nya dengan cari_chat atau chat_terakhir; id chat tidak pernah ditebak.',
    '- Perintah yang mengubah sesuatu TIDAK kamu jalankan: tulis jawaban + "usul". Operator akan menekan Jalankan.',
    '- Jangan menulis nomor telepon lengkap.',
    'Keluarkan SATU objek JSON saja per giliran, tanpa teks lain, tanpa ```:',
    '{"alat":"<nama alat>","args":{...}}  -- butuh data',
    '{"jawab":"<teks>"}  -- jawaban akhir',
    '{"jawab":"<teks>","usul":{"aksi":"<nama aksi>","args":{...}}}  -- jawaban + usulan tindakan',
    'Alat baca:',
    ...ALL_TOOLS.map((t) => `- ${t.name} ${t.argsHint}: ${t.description}`),
    'Aksi yang boleh diusulkan (pengerja di kurung):',
    ...ALL_ACTIONS.map((a) => `- ${a.name} ${a.argsHint} (${a.owner === agent ? 'kamu' : AGENT_PROFILES[a.owner].name}): ${a.description}`),
  ].join('\n')
}

type ModelTurn =
  | { kind: 'tool'; name: string; args: Record<string, unknown> }
  | { kind: 'answer'; reply: string; proposal: { action: string; args: Record<string, unknown> } | null }

/** Ambil objek JSON pertama dari keluaran model; teks polos = jawaban. */
export function parseModelTurn(raw: string): ModelTurn {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      const obj = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
      const args = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
      if (typeof obj.alat === 'string') return { kind: 'tool', name: obj.alat, args: args(obj.args) }
      if (typeof obj.jawab === 'string') {
        const usul = obj.usul && typeof obj.usul === 'object' ? (obj.usul as Record<string, unknown>) : null
        return {
          kind: 'answer',
          reply: obj.jawab.trim(),
          proposal: usul && typeof usul.aksi === 'string' ? { action: usul.aksi, args: args(usul.args) } : null,
        }
      }
    } catch {
      // Jatuh ke teks polos.
    }
  }
  return { kind: 'answer', reply: text, proposal: null }
}

export type RunAgentChatDeps = { llm?: typeof callLLM }

export async function runAgentChat(
  agent: AiAgentKey,
  messages: AgentChatMessage[],
  ctx: ToolCtx,
  deps: RunAgentChatDeps = {}
): Promise<AgentChatResponse> {
  const llm = deps.llm ?? callLLM
  const last = messages[messages.length - 1]
  if (!last || last.role !== 'user') throw new Error('Pesan terakhir harus dari operator')
  const settings = await prisma.settings.findUnique({ where: { id: 1 }, select: { ollamaModel: true } })
  const system = buildAgentSystemPrompt(agent, ctx.now)
  const history = messages.slice(0, -1)
  const used: string[] = []
  const results: string[] = []

  reportAiActivity(agent, 'mulai', 'Menjawab pertanyaan operator', '')
  try {
    for (let step = 0; step <= MAX_TOOL_STEPS; step++) {
      const prompt = results.length
        ? `${last.content}\n\n${results.join('\n\n')}\n\nLanjutkan: keluarkan satu objek JSON berikutnya.`
        : last.content
      const raw = await llm(prompt, { system, history, model: settings?.ollamaModel ?? undefined, timeoutMs: CHAT_TIMEOUT_MS })
      const turn = parseModelTurn(raw)

      if (turn.kind === 'tool') {
        if (step === MAX_TOOL_STEPS) break
        const tool = findTool(turn.name)
        if (!tool) {
          results.push(`[HASIL ALAT ${turn.name}] {"error":"alat tidak ada; pakai salah satu alat di daftar"}`)
          continue
        }
        const parsed = tool.args.safeParse(turn.args)
        if (!parsed.success) {
          results.push(`[HASIL ALAT ${tool.name}] {"error":"args tidak valid, contoh: ${tool.argsHint.replace(/"/g, "'")}"}`)
          continue
        }
        let output: unknown
        try {
          output = await tool.run(parsed.data, ctx)
        } catch (error) {
          console.error('ai-office chat: alat gagal', { agent, tool: tool.name, error: error instanceof Error ? error.name : 'unknown' })
          output = { error: 'alat gagal dijalankan' }
        }
        if (!used.includes(tool.label)) used.push(tool.label)
        results.push(`[HASIL ALAT ${tool.name}] ${JSON.stringify(output).slice(0, TOOL_RESULT_MAX_CHARS)}`)
        continue
      }

      let reply = turn.reply || 'Maaf, aku belum bisa menjawab itu.'
      let proposal: AgentProposal | null = null
      if (turn.proposal) {
        const action = findAction(turn.proposal.action)
        const parsed = action?.args.safeParse(turn.proposal.args)
        if (action && parsed?.success) {
          const check = await action.describe(parsed.data)
          if (check.ok) proposal = { action: action.name, args: parsed.data, summary: check.summary, owner: action.owner, ownerName: AGENT_PROFILES[action.owner].name }
          else reply = `${reply}\n\n(Usulan tidak bisa dibuat: ${check.error}.)`
        } else {
          reply = `${reply}\n\n(Itu belum bisa dikerjakan siapa pun di kantor ini.)`
        }
      }
      reportAiActivity(agent, 'selesai', proposal ? 'Usulan tindakan untuk operator' : 'Jawaban untuk operator siap', '')
      return { reply, proposal, used }
    }
    reportAiActivity(agent, 'selesai', 'Jawaban untuk operator siap', '')
    return { reply: 'Aku butuh terlalu banyak langkah untuk ini. Coba pertanyaan yang lebih spesifik.', proposal: null, used }
  } catch (error) {
    reportAiActivity(agent, 'gagal', 'Gagal menjawab operator', '')
    throw error
  }
}

import { callLLM } from './llm'
import { VARIABLE_FIELD_DEFS } from '../booking/variable-fields'

export type SuggestedVariable = { name: string; bindingKey: string | null }
export type TemplateSuggestion = {
  name: string
  body: string
  variables: SuggestedVariable[]
  reason: string
}

const MAX_SUGGESTIONS = 5
// Keeps the prompt bounded on a busy inbox -- the LLM only needs enough real examples to spot
// a recurring pattern, not every inbound message ever received.
const MAX_SAMPLE_MESSAGES = 200

function buildSystemPrompt(messages: string[]): string {
  const fieldKeys = VARIABLE_FIELD_DEFS.map((f) => `${f.key} (${f.label})`).join(', ')
  return (
    'Anda menganalisis kumpulan pesan MASUK dari pelanggan WhatsApp sebuah tour operator, untuk ' +
    'menemukan pertanyaan yang sering muncul dan mengusulkan template balasan cepat baru.\n\n' +
    'Berikut daftar pesan masuk pelanggan (contoh nyata, dari berbagai percakapan):\n' +
    messages.map((m, i) => `${i + 1}. ${m.replace(/\n/g, ' ').slice(0, 200)}`).join('\n') +
    '\n\n' +
    `Field data yang bisa dijadikan sumber variabel otomatis: ${fieldKeys}.\n\n` +
    'Balas HANYA dengan JSON valid persis seperti ini, tanpa markdown, tanpa teks lain di luar JSON:\n' +
    '{"suggestions":[{"name":"<nama_template_singkat>","body":"<isi balasan, gunakan {{1}}, {{2}} dst untuk variabel>",' +
    '"variables":[{"name":"<nama variabel>","bindingKey":"<salah satu key di atas, atau null untuk isi manual>"}],' +
    '"reason":"<alasan singkat, sebutkan pola pertanyaan yang mendasarinya>"}]}\n\n' +
    'Aturan:\n' +
    `- Usulkan maksimal ${MAX_SUGGESTIONS} template, hanya untuk pola pertanyaan yang BENAR-BENAR sering muncul di daftar di atas.\n` +
    '- Setiap {{n}} pada body harus punya entri yang sesuai di array variables, urut sesuai posisi.\n' +
    '- bindingKey hanya boleh salah satu key yang disebutkan di atas persis, atau null jika tidak ada yang cocok.\n' +
    '- Body harus benar-benar berguna sebagai balasan nyata untuk pola pertanyaan itu, jangan mengarang isi yang tidak relevan.\n' +
    '- Jika tidak ada pola yang cukup jelas dan berulang, balas {"suggestions":[]}.'
  )
}

// The model sometimes wraps JSON in a ```json fence despite instructions not to -- stripping it
// before parsing recovers an otherwise-valid response instead of failing outright on it.
function stripCodeFence(raw: string): string {
  return raw.trim().replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '')
}

/**
 * Analyzes a sample of real customer inbound messages (across the whole inbox, not one
 * conversation) with the same local Ollama model the bot itself answers with
 * (src/lib/bot/llm.ts), and drafts new QUICK_REPLY template suggestions for recurring
 * question patterns -- each with a suggested body, {{n}} variables, and an optional binding
 * to a real booking/contact data field (src/lib/booking/variable-fields.ts). Purely a drafting
 * aid for the admin reviewing /templates: nothing here creates a template on its own.
 */
export async function suggestTemplates(inboundMessages: string[], model?: string): Promise<TemplateSuggestion[]> {
  if (inboundMessages.length === 0) return []

  const sample = inboundMessages.slice(0, MAX_SAMPLE_MESSAGES)
  const raw = await callLLM('Analisis pesan-pesan pelanggan di atas dan usulkan template balasan cepat baru.', {
    system: buildSystemPrompt(sample),
    model,
  })

  let parsed: unknown
  try {
    parsed = JSON.parse(stripCodeFence(raw))
  } catch {
    throw new Error('Model tidak mengembalikan JSON yang valid')
  }

  const list = (parsed as { suggestions?: unknown } | null)?.suggestions
  if (!Array.isArray(list)) return []

  const validKeys = new Set(VARIABLE_FIELD_DEFS.map((f) => f.key))
  const out: TemplateSuggestion[] = []
  for (const item of list) {
    if (out.length >= MAX_SUGGESTIONS) break
    if (typeof item !== 'object' || item === null) continue
    const { name, body, variables, reason } = item as Record<string, unknown>
    if (typeof name !== 'string' || !name.trim()) continue
    if (typeof body !== 'string' || !body.trim()) continue
    if (typeof reason !== 'string' || !reason.trim()) continue

    const cleanVariables: SuggestedVariable[] = Array.isArray(variables)
      ? variables
          .filter(
            (v): v is { name: string; bindingKey?: unknown } =>
              typeof v === 'object' && v !== null && typeof (v as { name?: unknown }).name === 'string' && Boolean((v as { name: string }).name.trim())
          )
          .map((v) => ({
            name: v.name.trim(),
            bindingKey: typeof v.bindingKey === 'string' && validKeys.has(v.bindingKey) ? v.bindingKey : null,
          }))
      : []

    out.push({ name: name.trim(), body: body.trim(), variables: cleanVariables, reason: reason.trim() })
  }
  return out
}

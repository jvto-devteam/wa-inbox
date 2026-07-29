import { callLLM } from './llm'

export type RecommendableTemplate = { id: string; name: string; body: string }
export type TemplateRecommendation = { templateId: string; templateName: string; reason: string }

const MAX_RECOMMENDATIONS = 3
// Keeps the prompt bounded regardless of how long an individual template body is -- a
// recommendation only needs enough of the body to judge relevance, not the full text.
const BODY_PREVIEW_LENGTH = 300

function formatTemplateList(templates: RecommendableTemplate[]): string {
  return templates
    .map((t, i) => `${i + 1}. id="${t.id}" name="${t.name}" body="${t.body.replace(/"/g, "'").slice(0, BODY_PREVIEW_LENGTH)}"`)
    .join('\n')
}

function buildSystemPrompt(templates: RecommendableTemplate[]): string {
  return (
    'Anda membantu agen customer service memilih template balasan WhatsApp yang paling relevan ' +
    'untuk membalas pesan pelanggan.\n\n' +
    'Berikut daftar template yang tersedia:\n' +
    formatTemplateList(templates) +
    '\n\n' +
    'Balas HANYA dengan JSON valid persis seperti ini, tanpa markdown, tanpa teks lain di luar JSON:\n' +
    '{"recommendations":[{"templateId":"<id>","reason":"<alasan singkat dalam Bahasa Indonesia>"}]}\n\n' +
    'Aturan:\n' +
    `- Rekomendasikan maksimal ${MAX_RECOMMENDATIONS} template, urutkan dari paling relevan.\n` +
    '- Hanya gunakan id yang benar-benar ada di daftar di atas.\n' +
    '- Jika tidak ada template yang relevan, balas {"recommendations":[]}.'
  )
}

// The model sometimes wraps JSON in a ```json fence despite instructions not to -- stripping it
// before parsing recovers an otherwise-valid response instead of failing outright on it.
function stripCodeFence(raw: string): string {
  return raw.trim().replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '')
}

/**
 * Recommends up to MAX_RECOMMENDATIONS existing templates as replies to a customer's inbound
 * message, using the same local Ollama model the bot itself answers with (src/lib/bot/llm.ts).
 * This is an agent-facing suggestion tool, not an automated reply: nothing here ever sends a
 * message on its own -- it only ranks existing templates for a human to pick from.
 */
export async function recommendTemplates(
  inboundMessage: string,
  templates: RecommendableTemplate[],
  model?: string
): Promise<TemplateRecommendation[]> {
  if (templates.length === 0) return []

  const raw = await callLLM(inboundMessage, { system: buildSystemPrompt(templates), model })

  let parsed: unknown
  try {
    parsed = JSON.parse(stripCodeFence(raw))
  } catch {
    throw new Error('Model tidak mengembalikan JSON yang valid')
  }

  const list = (parsed as { recommendations?: unknown } | null)?.recommendations
  if (!Array.isArray(list)) return []

  const byId = new Map(templates.map((t) => [t.id, t]))
  const out: TemplateRecommendation[] = []
  for (const item of list) {
    if (out.length >= MAX_RECOMMENDATIONS) break
    if (typeof item !== 'object' || item === null) continue
    const { templateId, reason } = item as { templateId?: unknown; reason?: unknown }
    const template = typeof templateId === 'string' ? byId.get(templateId) : undefined
    // A hallucinated id (not in the list we gave the model) or a blank reason is dropped
    // rather than surfaced -- a recommendation with no real backing template can't be acted on.
    if (!template || typeof reason !== 'string' || !reason.trim()) continue
    out.push({ templateId: template.id, templateName: template.name, reason: reason.trim() })
  }
  return out
}

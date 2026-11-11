// LLM provider shim. Talks only to the VPS's own Ollama daemon, matching chatbot-web's setup --
// no other hosted-API fallback. Whether customer text leaves the VPS depends on the MODEL TAG,
// not on this file: a `-cloud` tag (the production default, gemma4:31b-cloud) makes the daemon
// forward inference to ollama.com; only a local tag keeps it on the machine. Two
// hard rules live here, both fail-safe rules for the bot brain that calls this file:
//
//   1. Every request is bounded by a timeout. `decideAndRespond` is awaited inline
//      all the way up through the inbound webhook handler, so a hung Ollama socket
//      would hang the webhook itself. The design principle is "timeout -> handoff",
//      which needs an actual timeout to fire: an aborted fetch rejects, which
//      propagates to the orchestrator's outer catch and becomes a handoff. 10s
//      matches the convention already set by src/lib/booking/client.ts.
//   2. A reply is validated before it is returned. An unexpected response shape
//      used to yield `undefined`, which travelled all the way to
//      `sendMessage({ text: undefined })` -- the customer silently got nothing,
//      and because the orchestrator had returned a "successful" decision, no
//      handoff alert was broadcast either.
//
// `system` carries grounding instructions and any sensitive context (e.g. booking
// data) OUT of the user turn, so raw customer text can never be read as an
// instruction that outranks them -- see the Mode 3 prompt in orchestrator.ts.

import { prisma } from '@/lib/db'

// Matches src/lib/booking/client.ts's existing 10s convention.
const LLM_TIMEOUT_MS = 10000

// Fallback only -- callers that care which model runs (see Settings.ollamaModel in the
// Chatbot page) pass their own via LLMOptions.model. Kept here so a caller that omits it
// (every existing test, and any future call site that doesn't care) still gets a real,
// working model rather than `undefined` reaching the provider's API. gemma4:31b-cloud is
// one of Ollama's own cloud-proxied model tags -- authenticated at the OS/daemon level on
// the VPS, so no app-level API key is needed, unlike the OpenAI provider this replaced.
const DEFAULT_OLLAMA_MODEL = 'gemma4:31b-cloud'

export type LLMOptions = {
  /** Grounding/system instructions, kept separate from the untrusted user turn. */
  system?: string
  /** Which model to ask Ollama for -- see DEFAULT_OLLAMA_MODEL above. */
  model?: string
  /**
   * Prior turns of this conversation, oldest first -- inserted between `system` and the final
   * user `prompt` as real per-turn roles (not flattened into the system text), so Ollama sees
   * an actual multi-turn chat instead of a single grounded question every time. Still untrusted
   * customer text on the 'user' entries -- the same prompt-injection reasoning that keeps
   * `system` separate from `prompt` applies here too.
   */
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
  /**
   * Per-turn grounding that belongs beside `system` but must not be spliced INTO it: sent as a
   * second system-role message, immediately after it. Added 2026-09-12 for the trip-preferences
   * extractor, whose own prompt is tuned and measured -- concatenating a per-turn sentence onto
   * that constant would change the exact text every measurement was taken against, for every
   * caller, on every turn. A separate message leaves the tuned block byte-identical.
   *
   * System-role, NOT `history`: this is OUR instruction about the conversation state, not
   * something the customer said, and the two must never be confusable at the model's end.
   */
  context?: string
  /**
   * Batas waktu request ini, dalam ms. Default LLM_TIMEOUT_MS (10 s) -- jalur balasan bot tidak
   * pernah mengisinya. Hanya job di luar jalur webhook (ringkasan harian, src/lib/daily-summary)
   * yang boleh menunggu lebih lama, karena tidak ada pelanggan atau webhook yang tertahan.
   */
  timeoutMs?: number
}

// A provider that answers with a non-string or a blank string has not answered.
// Throwing (rather than returning it) is what routes the caller to its fallback.
function requireNonEmptyReply(value: unknown, provider: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${provider} returned an empty or malformed response`)
  }
  return value
}

async function callOllama(
  prompt: string,
  system?: string,
  model?: string,
  history?: LLMOptions['history'],
  context?: string,
  timeoutMs?: number
): Promise<string> {
  const res = await fetch(`${process.env.OLLAMA_URL}/api/chat`, {
    method: 'POST',
    // Messages-array style (matching chatbot-web's src/chatbot.js), rather than
    // /api/generate's flat prompt+system fields -- same shape, same endpoint as the
    // already-authenticated Ollama daemon this app now shares with chatbot-web.
    body: JSON.stringify({
      model: model ?? DEFAULT_OLLAMA_MODEL,
      stream: false,
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        ...(context ? [{ role: 'system', content: context }] : []),
        ...(history ?? []),
        { role: 'user', content: prompt },
      ],
    }),
    signal: AbortSignal.timeout(timeoutMs ?? LLM_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error('Ollama request failed')
  const body = await res.json()
  return requireNonEmptyReply(body?.message?.content, 'Ollama')
}

// Jalur ALTERNATIF (2026-11-11): DeepSeek hosted API, dipilih operator lewat Settings.llmProvider
// (dropdown di /chatbot, simpan = langsung berlaku). Bawaan `ollama`: callLLM tetap persis seperti
// sebelumnya. Ditambahkan karena Ollama cloud menjawab 402 saat saldo akun $0. Konsekuensi yang
// disengaja pemilik: selama jalur ini menyala, teks pelanggan (dan data booking di Mode 3) dikirim
// ke api.deepseek.com. Key hanya dari env DEEPSEEK_API_KEY, tidak pernah di DB atau UI.
// `model` dari LLMOptions (tag Ollama dari Settings.ollamaModel) SENGAJA diabaikan di sini --
// tag itu tidak dikenal DeepSeek; nama model diatur env DEEPSEEK_MODEL (bawaan deepseek-chat).
// Pesan galat tidak pernah memuat key atau isi respons penyedia.
const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions'
const DEFAULT_DEEPSEEK_MODEL = 'deepseek-chat'

async function callDeepSeek(
  prompt: string,
  system?: string,
  history?: LLMOptions['history'],
  context?: string,
  timeoutMs?: number
): Promise<string> {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY belum diisi')
  const res = await fetch(DEEPSEEK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: process.env.DEEPSEEK_MODEL || DEFAULT_DEEPSEEK_MODEL,
      stream: false,
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        ...(context ? [{ role: 'system', content: context }] : []),
        ...(history ?? []),
        { role: 'user', content: prompt },
      ],
    }),
    signal: AbortSignal.timeout(timeoutMs ?? LLM_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`DeepSeek request failed (${res.status})`)
  const body = await res.json()
  return requireNonEmptyReply(body?.choices?.[0]?.message?.content, 'DeepSeek')
}

/**
 * Penyedia aktif dari `Settings.llmProvider`. Sengaja TANPA cache -- satu lookup berindeks pada
 * satu baris, dan /chatbot menjanjikan "simpan lalu langsung berlaku" (pola yang sama dengan
 * `settingsText` di runtime-integration.ts). Gagal-aman: nilai tak dikenal, baris hilang, atau DB
 * mati = Ollama, perilaku bot sebelum sakelar ada -- giliran bot tidak boleh mati hanya karena
 * pembacaan KONFIGURASI gagal.
 */
async function activeProvider(): Promise<'ollama' | 'deepseek'> {
  try {
    const row = await prisma.settings.findUnique({ where: { id: 1 }, select: { llmProvider: true } })
    return row?.llmProvider === 'deepseek' ? 'deepseek' : 'ollama'
  } catch (error) {
    console.error('llm: gagal membaca Settings.llmProvider, memakai Ollama', { error })
    return 'ollama'
  }
}

export async function callLLM(prompt: string, opts?: LLMOptions): Promise<string> {
  if ((await activeProvider()) === 'deepseek') {
    return callDeepSeek(prompt, opts?.system, opts?.history, opts?.context, opts?.timeoutMs)
  }
  return callOllama(prompt, opts?.system, opts?.model, opts?.history, opts?.context, opts?.timeoutMs)
}

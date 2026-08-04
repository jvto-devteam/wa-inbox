// LLM provider shim. Local-only (Ollama), matching chatbot-web's setup -- no hosted-API
// fallback, so customer text and booking data never leave the VPS's own Ollama daemon. Two
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
  history?: LLMOptions['history']
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
        ...(history ?? []),
        { role: 'user', content: prompt },
      ],
    }),
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error('Ollama request failed')
  const body = await res.json()
  return requireNonEmptyReply(body?.message?.content, 'Ollama')
}

export async function callLLM(prompt: string, opts?: LLMOptions): Promise<string> {
  return callOllama(prompt, opts?.system, opts?.model, opts?.history)
}

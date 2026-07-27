// LLM provider shim. Two hard rules live here, both of them fail-safe rules for
// the bot brain that calls this file:
//
//   1. Every request is bounded by a timeout. `decideAndRespond` is awaited inline
//      all the way up through the inbound webhook handler, so a hung Ollama/OpenAI
//      socket would hang the webhook itself. The design principle is "timeout ->
//      handoff", which needs an actual timeout to fire: an aborted fetch rejects,
//      which propagates to the orchestrator's outer catch and becomes a handoff.
//      10s matches the convention already set by src/lib/booking/client.ts.
//   2. A reply is validated before it is returned. An unexpected response shape
//      used to yield `undefined`, which travelled all the way to
//      `sendMessage({ text: undefined })` -- the customer silently got nothing,
//      and because the orchestrator had returned a "successful" decision, no
//      handoff alert was broadcast either. Throwing instead means a bad local
//      response still falls through to OpenAI (when `forceLocal` isn't set), and
//      to the orchestrator's fail-safe handoff either way.
//
// `system` carries grounding instructions and any sensitive context (e.g. booking
// data) OUT of the user turn, so raw customer text can never be read as an
// instruction that outranks them -- see the Mode 3 prompt in orchestrator.ts.

// Matches src/lib/booking/client.ts's existing 10s convention.
const LLM_TIMEOUT_MS = 10000

export type LLMOptions = {
  forceLocal?: boolean
  /** Grounding/system instructions, kept separate from the untrusted user turn. */
  system?: string
}

// A provider that answers with a non-string or a blank string has not answered.
// Throwing (rather than returning it) is what routes the caller to its fallback.
function requireNonEmptyReply(value: unknown, provider: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${provider} returned an empty or malformed response`)
  }
  return value
}

async function callOllama(prompt: string, system?: string): Promise<string> {
  const res = await fetch(`${process.env.OLLAMA_URL}/api/generate`, {
    method: 'POST',
    // Ollama's /api/generate accepts a top-level `system` field (documented
    // alongside `template`/`raw`/`format`), which overrides the Modelfile's
    // SYSTEM block -- so the grounding instructions do not have to be
    // concatenated into `prompt` next to untrusted customer text.
    body: JSON.stringify({ model: 'llama3', prompt, stream: false, ...(system ? { system } : {}) }),
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error('Ollama request failed')
  const body = await res.json()
  return requireNonEmptyReply(body?.response, 'Ollama')
}

async function callOpenAI(prompt: string, system?: string): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        { role: 'user', content: prompt },
      ],
    }),
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error('OpenAI request failed')
  const body = await res.json()
  // Optional chaining throughout: a malformed body must produce the explicit
  // "empty or malformed" error below, not a raw TypeError on `choices[0]`.
  return requireNonEmptyReply(body?.choices?.[0]?.message?.content, 'OpenAI')
}

export async function callLLM(prompt: string, opts?: LLMOptions): Promise<string> {
  if (opts?.forceLocal) return callOllama(prompt, opts.system)
  try {
    return await callOpenAI(prompt, opts?.system)
  } catch {
    return callOllama(prompt, opts?.system)
  }
}

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { callLLM } from './llm'

// A single hoisted mock rather than `(fetch as any)` at each call site: it keeps the
// `.mock.calls` inspections below type-safe, which matters here because several tests
// assert on the exact request body (the `system` field, the AbortSignal).
const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  process.env.OPENAI_API_KEY = 'sk-test'
  process.env.OLLAMA_URL = 'http://localhost:11434'
})

describe('callLLM', () => {
  it('calls OpenAI by default', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: 'Jawaban dari OpenAI' } }] }) })
    const result = await callLLM('Apa saja paket Ijen?')
    expect(result).toBe('Jawaban dari OpenAI')
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('api.openai.com'), expect.anything())
  })

  it('calls Ollama when forceLocal is true, never touching OpenAI', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ response: 'Jawaban dari Ollama' }) })
    const result = await callLLM('Booking saya kapan?', { forceLocal: true })
    expect(result).toBe('Jawaban dari Ollama')
    expect(fetch).toHaveBeenCalledWith('http://localhost:11434/api/generate', expect.anything())
  })

  it('falls back to Ollama when OpenAI errors', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: { message: 'rate limited' } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ response: 'Fallback dari Ollama' }) })
    const result = await callLLM('Apa saja paket Ijen?')
    expect(result).toBe('Fallback dari Ollama')
  })

  it('throws when Ollama returns error with forceLocal', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) })
    await expect(callLLM('Booking saya kapan?', { forceLocal: true })).rejects.toThrow('Ollama request failed')
  })

  // --- Timeouts (I5) -------------------------------------------------------
  // decideAndRespond is awaited inline through the inbound webhook handler, so an
  // unbounded LLM socket hangs the webhook. "timeout -> handoff" needs a timeout
  // that actually fires: the abort must surface as a rejection, not a hung promise.

  it('passes an AbortSignal to Ollama so a hung request cannot hang the webhook', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ response: 'ok' }) })
    await callLLM('Booking saya kapan?', { forceLocal: true })
    const [, init] = fetchMock.mock.calls[0]
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('passes an AbortSignal to OpenAI too', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) })
    await callLLM('Apa saja paket Ijen?')
    const [, init] = fetchMock.mock.calls[0]
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('rejects (rather than hanging) when the local request is aborted by its timeout', async () => {
    fetchMock.mockRejectedValue(new DOMException('The operation was aborted.', 'TimeoutError'))
    await expect(callLLM('Booking saya kapan?', { forceLocal: true })).rejects.toThrow()
  })

  it('still falls back to Ollama when the OpenAI request times out', async () => {
    fetchMock
      .mockRejectedValueOnce(new DOMException('The operation was aborted.', 'TimeoutError'))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ response: 'Fallback dari Ollama' }) })
    expect(await callLLM('Apa saja paket Ijen?')).toBe('Fallback dari Ollama')
  })

  // --- Output validation (I5) ----------------------------------------------
  // An unvalidated `undefined` used to travel all the way to
  // sendMessage({ text: undefined }): the customer silently got nothing, and no
  // handoff alert fired because the decision itself looked successful.

  it.each([
    ['a missing response field', {}],
    ['a null response', { response: null }],
    ['an empty-string response', { response: '' }],
    ['a whitespace-only response', { response: '   \n ' }],
    ['a non-string response', { response: { text: 'oops' } }],
  ])('throws instead of returning %s from Ollama', async (_label, body) => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => body })
    await expect(callLLM('Booking saya kapan?', { forceLocal: true })).rejects.toThrow(
      'Ollama returned an empty or malformed response'
    )
  })

  it.each([
    ['an empty choices array', { choices: [] }],
    ['a missing message', { choices: [{}] }],
    ['an empty content string', { choices: [{ message: { content: '' } }] }],
    ['a whitespace-only content string', { choices: [{ message: { content: '  ' } }] }],
  ])('falls back to Ollama when OpenAI returns %s', async (_label, body) => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => body })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ response: 'Fallback dari Ollama' }) })
    expect(await callLLM('Apa saja paket Ijen?')).toBe('Fallback dari Ollama')
  })

  it('throws when BOTH providers return malformed bodies, rather than resolving undefined', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) })
    await expect(callLLM('Apa saja paket Ijen?')).rejects.toThrow('Ollama returned an empty or malformed response')
  })

  // --- System parameter (I6) -----------------------------------------------
  // Ollama's /api/generate accepts a top-level `system` field, so grounding
  // instructions and sensitive context stay out of the untrusted user turn.

  it('sends the system instructions as a top-level `system` field to Ollama, separate from the prompt', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ response: 'ok' }) })
    await callLLM('Sudah lunas belum?', { forceLocal: true, system: 'Data booking: {"id":"B1"}' })
    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body)
    expect(body.system).toBe('Data booking: {"id":"B1"}')
    expect(body.prompt).toBe('Sudah lunas belum?')
  })

  it('omits the system field entirely when no system prompt is given', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ response: 'ok' }) })
    await callLLM('Halo', { forceLocal: true })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).not.toHaveProperty('system')
  })

  it('maps the system prompt to an OpenAI system message ahead of the user turn', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) })
    await callLLM('Halo', { system: 'Anda asisten JVTO.' })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.messages).toEqual([
      { role: 'system', content: 'Anda asisten JVTO.' },
      { role: 'user', content: 'Halo' },
    ])
  })
})

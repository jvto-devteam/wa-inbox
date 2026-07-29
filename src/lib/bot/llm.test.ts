import { describe, it, expect, vi, beforeEach } from 'vitest'
import { callLLM } from './llm'

// A single hoisted mock rather than `(fetch as any)` at each call site: it keeps the
// `.mock.calls` inspections below type-safe, which matters here because several tests
// assert on the exact request body (the `messages` array, the AbortSignal).
const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  process.env.OLLAMA_URL = 'http://localhost:11434'
})

describe('callLLM', () => {
  it('calls Ollama /api/chat', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ message: { content: 'Jawaban dari Ollama' } }) })
    const result = await callLLM('Apa saja paket Ijen?')
    expect(result).toBe('Jawaban dari Ollama')
    expect(fetch).toHaveBeenCalledWith('http://localhost:11434/api/chat', expect.anything())
  })

  it('throws when Ollama returns an error response', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) })
    await expect(callLLM('Booking saya kapan?')).rejects.toThrow('Ollama request failed')
  })

  it('defaults to gemma4:31b-cloud when no model override is given', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ message: { content: 'ok' } }) })
    await callLLM('Apa saja paket Ijen?')
    const [, options] = fetchMock.mock.calls[0]
    expect(JSON.parse(options.body).model).toBe('gemma4:31b-cloud')
  })

  it('uses the given model override', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ message: { content: 'ok' } }) })
    await callLLM('Booking saya kapan?', { model: 'mistral' })
    const [, options] = fetchMock.mock.calls[0]
    expect(JSON.parse(options.body).model).toBe('mistral')
  })

  // --- Timeouts (I5) -------------------------------------------------------
  // decideAndRespond is awaited inline through the inbound webhook handler, so an
  // unbounded LLM socket hangs the webhook. "timeout -> handoff" needs a timeout
  // that actually fires: the abort must surface as a rejection, not a hung promise.

  it('passes an AbortSignal so a hung request cannot hang the webhook', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ message: { content: 'ok' } }) })
    await callLLM('Booking saya kapan?')
    const [, init] = fetchMock.mock.calls[0]
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('rejects (rather than hanging) when the request is aborted by its timeout', async () => {
    fetchMock.mockRejectedValue(new DOMException('The operation was aborted.', 'TimeoutError'))
    await expect(callLLM('Booking saya kapan?')).rejects.toThrow()
  })

  // --- Output validation (I5) ----------------------------------------------
  // An unvalidated `undefined` used to travel all the way to
  // sendMessage({ text: undefined }): the customer silently got nothing, and no
  // handoff alert fired because the decision itself looked successful.

  it.each([
    ['a missing message field', {}],
    ['a null content', { message: { content: null } }],
    ['an empty-string content', { message: { content: '' } }],
    ['a whitespace-only content', { message: { content: '   \n ' } }],
    ['a non-string content', { message: { content: { text: 'oops' } } }],
  ])('throws instead of returning %s from Ollama', async (_label, body) => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => body })
    await expect(callLLM('Booking saya kapan?')).rejects.toThrow('Ollama returned an empty or malformed response')
  })

  // --- System parameter (I6) -----------------------------------------------
  // Grounding instructions and sensitive context stay out of the untrusted user turn --
  // sent as a leading `system` role message, matching chatbot-web's /api/chat shape.

  it('sends the system instructions as a leading system-role message, separate from the prompt', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ message: { content: 'ok' } }) })
    await callLLM('Sudah lunas belum?', { system: 'Data booking: {"id":"B1"}' })
    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body)
    expect(body.messages).toEqual([
      { role: 'system', content: 'Data booking: {"id":"B1"}' },
      { role: 'user', content: 'Sudah lunas belum?' },
    ])
  })

  it('sends only the user turn when no system prompt is given', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ message: { content: 'ok' } }) })
    await callLLM('Halo')
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.messages).toEqual([{ role: 'user', content: 'Halo' }])
  })
})

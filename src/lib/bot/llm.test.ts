import { describe, it, expect, vi, beforeEach } from 'vitest'
import { callLLM } from './llm'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  process.env.OPENAI_API_KEY = 'sk-test'
  process.env.OLLAMA_URL = 'http://localhost:11434'
})

describe('callLLM', () => {
  it('calls OpenAI by default', async () => {
    ;(fetch as any).mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: 'Jawaban dari OpenAI' } }] }) })
    const result = await callLLM('Apa saja paket Ijen?')
    expect(result).toBe('Jawaban dari OpenAI')
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('api.openai.com'), expect.anything())
  })

  it('calls Ollama when forceLocal is true, never touching OpenAI', async () => {
    ;(fetch as any).mockResolvedValue({ ok: true, json: async () => ({ response: 'Jawaban dari Ollama' }) })
    const result = await callLLM('Booking saya kapan?', { forceLocal: true })
    expect(result).toBe('Jawaban dari Ollama')
    expect(fetch).toHaveBeenCalledWith('http://localhost:11434/api/generate', expect.anything())
  })

  it('falls back to Ollama when OpenAI errors', async () => {
    ;(fetch as any)
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: { message: 'rate limited' } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ response: 'Fallback dari Ollama' }) })
    const result = await callLLM('Apa saja paket Ijen?')
    expect(result).toBe('Fallback dari Ollama')
  })
})

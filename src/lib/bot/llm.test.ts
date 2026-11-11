import { describe, it, expect, vi, beforeEach } from 'vitest'
import { callLLM } from './llm'

// Penyedia LLM dibaca dari Settings.llmProvider (satu baris, id=1) tiap panggilan -- tanpa DB nyata.
const { findUniqueMock } = vi.hoisted(() => ({ findUniqueMock: vi.fn() }))
vi.mock('@/lib/db', () => ({ prisma: { settings: { findUnique: findUniqueMock } } }))

// A single hoisted mock rather than `(fetch as any)` at each call site: it keeps the
// `.mock.calls` inspections below type-safe, which matters here because several tests
// assert on the exact request body (the `messages` array, the AbortSignal).
const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  process.env.OLLAMA_URL = 'http://localhost:11434'
  findUniqueMock.mockReset()
  findUniqueMock.mockResolvedValue({ llmProvider: 'ollama' })
  delete process.env.DEEPSEEK_API_KEY
  delete process.env.DEEPSEEK_MODEL
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

  it('keeps the 10s timeout when no timeoutMs is given, and uses timeoutMs when it is', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ message: { content: 'ok' } }) })
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout')
    await callLLM('Booking saya kapan?')
    await callLLM('Ringkas percakapan ini', { timeoutMs: 60_000 })
    expect(timeoutSpy.mock.calls).toEqual([[10_000], [60_000]])
    timeoutSpy.mockRestore()
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

  // Konteks per-giliran (12 September 2026): pesan system KEDUA, bukan sambungan string ke
  // `system`. Prompt yang ditala dan diukur (mis. EXTRACTION_SYSTEM_PROMPT) harus tetap utuh
  // sebagai satu blok -- ini yang membuat penambahan konteks tidak menghitung ulang tuningnya.
  it('mengirim konteks per-giliran sebagai pesan system kedua, sesudah system utama', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ message: { content: 'ok' } }) })
    await callLLM('Surabaya', { system: 'Instruksi utama', context: 'Yang kurang: finishCity.' })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.messages).toEqual([
      { role: 'system', content: 'Instruksi utama' },
      { role: 'system', content: 'Yang kurang: finishCity.' },
      { role: 'user', content: 'Surabaya' },
    ])
  })

  it('tidak mengirim pesan konteks saat tidak ada konteks', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ message: { content: 'ok' } }) })
    await callLLM('Surabaya', { system: 'Instruksi utama' })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.messages).toHaveLength(2)
  })

  it('sends only the user turn when no system prompt is given', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ message: { content: 'ok' } }) })
    await callLLM('Halo')
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.messages).toEqual([{ role: 'user', content: 'Halo' }])
  })

  // --- Conversation history -------------------------------------------------
  // Prior turns are inserted as real per-turn roles between `system` and the final
  // `prompt`, not flattened into the system text -- Ollama gets an actual multi-turn
  // chat, matching how a human reading the thread would see it.

  it('inserts history between the system message and the final user prompt, in order', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ message: { content: 'ok' } }) })
    await callLLM('Kalau yang itu gimana?', {
      system: 'Data booking: {"id":"B1"}',
      history: [
        { role: 'user', content: 'Sudah lunas belum?' },
        { role: 'assistant', content: 'Belum, sisa Rp500.000.' },
      ],
    })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.messages).toEqual([
      { role: 'system', content: 'Data booking: {"id":"B1"}' },
      { role: 'user', content: 'Sudah lunas belum?' },
      { role: 'assistant', content: 'Belum, sisa Rp500.000.' },
      { role: 'user', content: 'Kalau yang itu gimana?' },
    ])
  })

  it('sends no history entries when none are given', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ message: { content: 'ok' } }) })
    await callLLM('Halo', { system: 'Data booking: {}' })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.messages).toEqual([
      { role: 'system', content: 'Data booking: {}' },
      { role: 'user', content: 'Halo' },
    ])
  })
})

// --- Jalur DeepSeek (2026-11-11) --------------------------------------------------------
// Jalur ALTERNATIF yang dipilih operator di Pengaturan (Settings.llmProvider), ditambahkan karena
// Ollama cloud menjawab 402 (saldo $0). Bawaan tetap Ollama -- semua test di atas membuktikannya.
// Teks pelanggan dikirim ke api.deepseek.com bila jalur ini menyala. Key hanya dari env.
describe('callLLM -- jalur DeepSeek', () => {
  const ok = { ok: true, json: async () => ({ choices: [{ message: { content: 'Jawaban DeepSeek' } }] }) }

  beforeEach(() => {
    findUniqueMock.mockResolvedValue({ llmProvider: 'deepseek' })
    process.env.DEEPSEEK_API_KEY = 'sk-test-rahasia'
  })

  it('memanggil api.deepseek.com/chat/completions dengan Bearer key, bukan Ollama', async () => {
    fetchMock.mockResolvedValue(ok)
    const result = await callLLM('Apa saja paket Ijen?')
    expect(result).toBe('Jawaban DeepSeek')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.deepseek.com/chat/completions')
    expect(init.headers.Authorization).toBe('Bearer sk-test-rahasia')
    expect(init.headers['Content-Type']).toBe('application/json')
  })

  it('memakai deepseek-chat, mengabaikan tag model Ollama dari opts.model', async () => {
    fetchMock.mockResolvedValue(ok)
    await callLLM('Halo', { model: 'gemma4:31b-cloud' })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe('deepseek-chat')
  })

  it('DEEPSEEK_MODEL menimpa nama model bawaan', async () => {
    process.env.DEEPSEEK_MODEL = 'deepseek-reasoner'
    fetchMock.mockResolvedValue(ok)
    await callLLM('Halo')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe('deepseek-reasoner')
  })

  it('membangun messages sama seperti Ollama: system, context, history, lalu user, non-stream', async () => {
    fetchMock.mockResolvedValue(ok)
    await callLLM('Kalau yang itu?', {
      system: 'Instruksi utama',
      context: 'Konteks giliran',
      history: [{ role: 'user', content: 'Halo' }, { role: 'assistant', content: 'Hai' }],
    })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.stream).toBe(false)
    expect(body.messages).toEqual([
      { role: 'system', content: 'Instruksi utama' },
      { role: 'system', content: 'Konteks giliran' },
      { role: 'user', content: 'Halo' },
      { role: 'assistant', content: 'Hai' },
      { role: 'user', content: 'Kalau yang itu?' },
    ])
  })

  it('tetap dibatasi timeout: 10 s bawaan, timeoutMs bila diberikan', async () => {
    fetchMock.mockResolvedValue(ok)
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout')
    await callLLM('Halo')
    await callLLM('Ringkas', { timeoutMs: 60_000 })
    expect(timeoutSpy.mock.calls).toEqual([[10_000], [60_000]])
    timeoutSpy.mockRestore()
  })

  it('melempar tanpa membocorkan key atau isi respons saat status bukan 2xx', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 402, json: async () => ({ error: 'Insufficient Balance sk-test-rahasia' }) })
    const err = await callLLM('Halo').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toBe('DeepSeek request failed (402)')
    expect((err as Error).message).not.toContain('sk-test-rahasia')
  })

  it('melempar sebelum menghubungi jaringan bila DEEPSEEK_API_KEY kosong', async () => {
    delete process.env.DEEPSEEK_API_KEY
    await expect(callLLM('Halo')).rejects.toThrow('DEEPSEEK_API_KEY belum diisi')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['tanpa choices', {}],
    ['choices kosong', { choices: [] }],
    ['content null', { choices: [{ message: { content: null } }] }],
    ['content kosong', { choices: [{ message: { content: '  ' } }] }],
  ])('melempar, bukan mengembalikan balasan kosong (%s)', async (_label, body) => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => body })
    await expect(callLLM('Halo')).rejects.toThrow('DeepSeek returned an empty or malformed response')
  })

  // --- Sakelar di Pengaturan: dibaca tiap panggilan (tanpa cache), gagal-aman ke Ollama ---------
  const ollamaOk = { ok: true, json: async () => ({ message: { content: 'dari Ollama' } }) }

  it('switch langsung berlaku: panggilan berikutnya mengikuti nilai Settings terbaru', async () => {
    fetchMock.mockResolvedValue(ok)
    await callLLM('satu')
    findUniqueMock.mockResolvedValue({ llmProvider: 'ollama' })
    fetchMock.mockResolvedValue(ollamaOk)
    await callLLM('dua')
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      'https://api.deepseek.com/chat/completions',
      'http://localhost:11434/api/chat',
    ])
    expect(findUniqueMock).toHaveBeenCalledWith({ where: { id: 1 }, select: { llmProvider: true } })
  })

  it.each([
    ['nilai tak dikenal', { llmProvider: 'openai' }],
    ['baris Settings tidak ada', null],
    ['kolom kosong', { llmProvider: null }],
  ])('memakai Ollama bila Settings: %s', async (_label, row) => {
    findUniqueMock.mockResolvedValue(row)
    fetchMock.mockResolvedValue(ollamaOk)
    expect(await callLLM('Halo')).toBe('dari Ollama')
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:11434/api/chat')
  })

  it('gagal-aman ke Ollama (bukan melempar) bila DB tidak terbaca', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    findUniqueMock.mockRejectedValue(new Error('db down'))
    fetchMock.mockResolvedValue(ollamaOk)
    expect(await callLLM('Halo')).toBe('dari Ollama')
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:11434/api/chat')
    errSpy.mockRestore()
  })
})

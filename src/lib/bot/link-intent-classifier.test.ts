import { describe, it, expect, vi, beforeEach } from 'vitest'
import { detectsPackageLinkIntentViaLLM } from './link-intent-classifier'
import { callLLM } from './llm'

vi.mock('./llm', () => ({ callLLM: vi.fn() }))

beforeEach(() => vi.mocked(callLLM).mockReset())

const regexFallback = (message: string) => message.toLowerCase().includes('we want to book')

describe('detectsPackageLinkIntentViaLLM', () => {
  // Pesan nyata yang memicu konversi ini (12 September 2026): frasa "we'd like to book" tidak ada
  // di BOOKING_INTENT_KEYWORDS, yang memuat "we want to book" -- beda satu kata, dan pelanggan
  // yang menyebut paketnya sendiri dikirimi halaman panduan umum alih-alih halaman paket itu.
  it('mengenali pelanggan yang sudah mengunci satu paket, walau frasanya tidak ada di daftar kata kunci', async () => {
    vi.mocked(callLLM).mockResolvedValue(JSON.stringify({ wantsPackageLink: true }))
    const result = await detectsPackageLinkIntentViaLLM(
      "We're 2 people and we'd like to book your Bromo 1D1N tour from Surabaya for 12–13 September.",
      regexFallback,
      'gemma4:31b-cloud'
    )
    expect(result).toEqual({ wantsPackageLink: true, source: 'llm' })
  })

  it('tidak menganggap pertanyaan kebijakan umum sebagai niat halaman paket', async () => {
    vi.mocked(callLLM).mockResolvedValue(JSON.stringify({ wantsPackageLink: false }))
    const result = await detectsPackageLinkIntentViaLLM(
      'how do I pay the deposit, and is it refundable?',
      regexFallback,
      'gemma4:31b-cloud'
    )
    expect(result.wantsPackageLink).toBe(false)
  })

  it('kembali ke pemeriksaan regex saat jawaban model bukan JSON yang sah', async () => {
    vi.mocked(callLLM).mockResolvedValue('not json')
    const result = await detectsPackageLinkIntentViaLLM('we want to book the Bromo tour', regexFallback, 'gemma4:31b-cloud')
    expect(result).toEqual({ wantsPackageLink: true, source: 'regex_fallback' })
  })

  it('kembali ke pemeriksaan regex saat callLLM melempar', async () => {
    vi.mocked(callLLM).mockRejectedValueOnce(new Error('timeout'))
    const result = await detectsPackageLinkIntentViaLLM('completely unrelated message', regexFallback, 'gemma4:31b-cloud')
    expect(result).toEqual({ wantsPackageLink: false, source: 'regex_fallback' })
  })

  it('menolak bentuk JSON yang benar tapi nilainya bukan boolean', async () => {
    vi.mocked(callLLM).mockResolvedValue(JSON.stringify({ wantsPackageLink: 'yes' }))
    const result = await detectsPackageLinkIntentViaLLM('we want to book the Bromo tour', regexFallback, 'gemma4:31b-cloud')
    expect(result.source).toBe('regex_fallback')
  })

  it('mengirim teks pelanggan mentah sebagai prompt, instruksinya sebagai system', async () => {
    vi.mocked(callLLM).mockResolvedValue(JSON.stringify({ wantsPackageLink: false }))
    await detectsPackageLinkIntentViaLLM('some message', regexFallback, 'gemma4:31b-cloud')
    expect(callLLM).toHaveBeenCalledWith(
      'some message',
      expect.objectContaining({
        model: 'gemma4:31b-cloud',
        system: expect.stringContaining('SPECIFIC package'),
      })
    )
  })
})

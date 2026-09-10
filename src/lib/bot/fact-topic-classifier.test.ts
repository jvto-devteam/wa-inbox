import { describe, expect, it, vi, beforeEach } from 'vitest'
import { classifyFactTopics } from './fact-topic-classifier'
import { callLLM } from './llm'

vi.mock('./llm', () => ({ callLLM: vi.fn() }))

describe('classifyFactTopics', () => {
  beforeEach(() => vi.mocked(callLLM).mockReset())

  it('mengembalikan beberapa topik untuk fakta yang melayani lebih dari satu', async () => {
    vi.mocked(callLLM).mockResolvedValue('{"topics":["route_endpoint","price"]}')
    const topics = await classifyFactTopics('Bisa drop off di Malang?', 'Bisa, surcharge IDR 250.000.')
    expect(topics).toEqual(['route_endpoint', 'price'])
  })

  it('membuang topik karangan yang tidak ada di 14 nilai resmi', async () => {
    vi.mocked(callLLM).mockResolvedValue('{"topics":["payment","topik_karangan"]}')
    const topics = await classifyFactTopics('Q', 'A')
    expect(topics).toEqual(['payment'])
  })

  it('mengembalikan daftar kosong saat LLM gagal — tidak boleh memblokir penyimpanan', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    // mockRejectedValueOnce, bukan mockRejectedValue: pola yang sama dipakai
    // topic-classifier.test.ts untuk skenario ini (lihat file itu). Persistent
    // mockRejectedValue lewat modul terpisah + await/catch terbukti memicu
    // "unhandled rejection" palsu di lingkungan vitest 4 repo ini -- diverifikasi
    // dengan reproduksi terisolasi, bukan flaky: classifyFactTopics tetap benar
    // menangkap & mencatat error (console.error teramati terpanggil) baik dengan
    // mockRejectedValue maupun mockRejectedValueOnce, hanya reporter test yang
    // salah atribusi kegagalan ke baris ini. Once cukup karena callLLM dipanggil
    // sekali per pemanggilan classifyFactTopics.
    vi.mocked(callLLM).mockRejectedValueOnce(new Error('timeout'))
    const topics = await classifyFactTopics('Q', 'A')
    expect(topics).toEqual([])
    expect(logged).toHaveBeenCalled()
    logged.mockRestore()
  })

  it('mengembalikan daftar kosong saat keluaran bukan JSON', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(callLLM).mockResolvedValue('maaf saya tidak paham')
    const topics = await classifyFactTopics('Q', 'A')
    expect(topics).toEqual([])
    expect(logged).toHaveBeenCalled()
    logged.mockRestore()
  })
})

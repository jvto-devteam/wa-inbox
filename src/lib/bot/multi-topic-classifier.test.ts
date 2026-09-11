import { describe, expect, it, vi, beforeEach } from 'vitest'
import { classifyAllTopics } from './multi-topic-classifier'
import { callLLM } from './llm'

vi.mock('./llm', () => ({ callLLM: vi.fn() }))

describe('classifyAllTopics', () => {
  beforeEach(() => vi.mocked(callLLM).mockReset())

  it('mengembalikan semua topik sah yang benar-benar ditanyakan', async () => {
    vi.mocked(callLLM).mockResolvedValue('{"topics":["booking","payment","cancellation","blue_fire"]}')
    const topics = await classifyAllTopics(
      'how to book…? how many percent … deposit? how about the cancellation and can i see the blue fire?'
    )
    expect(topics).toEqual(['booking', 'payment', 'cancellation', 'blue_fire'])
  })

  it('membuang topik karangan yang tidak ada di 14 nilai resmi RESOLVER_TOPICS', async () => {
    vi.mocked(callLLM).mockResolvedValue('{"topics":["payment","topik_karangan"]}')
    const topics = await classifyAllTopics('pesan')
    expect(topics).toEqual(['payment'])
  })

  it('membuang duplikat, menyisakan satu', async () => {
    vi.mocked(callLLM).mockResolvedValue('{"topics":["payment","payment","booking"]}')
    const topics = await classifyAllTopics('pesan')
    expect(topics).toEqual(['payment', 'booking'])
  })

  it('membuang general dan greeting -- bukan topik tambahan yang bermakna', async () => {
    vi.mocked(callLLM).mockResolvedValue('{"topics":["general","greeting","payment"]}')
    const topics = await classifyAllTopics('pesan')
    expect(topics).toEqual(['payment'])
  })

  it('memotong ke maksimal 6 topik saat model mengembalikan lebih', async () => {
    vi.mocked(callLLM).mockResolvedValue(
      '{"topics":["booking","payment","cancellation","blue_fire","inclusions","price","vehicle","hotel"]}'
    )
    const topics = await classifyAllTopics('pesan')
    expect(topics).toEqual(['booking', 'payment', 'cancellation', 'blue_fire', 'inclusions', 'price'])
  })

  // Ruling R103: bukti produksi (cmsn7yfn) -- permintaan penawaran yang menanyakan 6 topik.
  // Plafon 4 membuang payment dan cancellation; plafon 6 menyimpan keenamnya.
  it('menyimpan keenam topik permintaan penawaran (price, inclusions, private_tour, vehicle, payment, cancellation)', async () => {
    vi.mocked(callLLM).mockResolvedValue(
      '{"topics":["price","inclusions","private_tour","vehicle","payment","cancellation"]}'
    )
    const topics = await classifyAllTopics('pesan')
    expect(topics).toEqual(['price', 'inclusions', 'private_tour', 'vehicle', 'payment', 'cancellation'])
  })

  // Ruling R104: disambiguasi yang disalin dari prompt classifier topik UTAMA
  // (topic-classifier.ts) harus benar-benar sampai ke prompt panggilan ini.
  it('prompt memuat disambiguasi transfer, blue flames, daftar destinasi, contoh topik-konteks, dan plafon 6', async () => {
    vi.mocked(callLLM).mockResolvedValue('{"topics":[]}')
    await classifyAllTopics('pesan')
    const system = vi.mocked(callLLM).mock.calls[0]?.[1]?.system ?? ''
    expect(system).toContain(
      'A message mentioning "transfer" in a travel sense (an airport/inter-city transfer, not a money transfer) is NOT this topic.'
    )
    expect(system).toContain('(including paraphrases like "blue flames")')
    expect(system).toContain('(Ijen, Bromo, Tumpak Sewu, Madakaripura, Papuma)')
    expect(system).toContain('Message: "Does the price include the airport transfer?"\nOutput: {"topics": ["inclusions"]}')
    expect(system).toContain('Most messages ask about only one thing')
    expect(system).toContain('List at most 6 topics')
  })

  it('mengembalikan daftar kosong saat LLM gagal, dicatat lewat console.error -- tidak boleh memblokir giliran', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    // mockRejectedValueOnce, pola yang sama dipakai fact-topic-classifier.test.ts/
    // topic-classifier.test.ts untuk menghindari "unhandled rejection" palsu vitest 4.
    vi.mocked(callLLM).mockRejectedValueOnce(new Error('timeout'))
    const topics = await classifyAllTopics('pesan')
    expect(topics).toEqual([])
    expect(logged).toHaveBeenCalled()
    logged.mockRestore()
  })

  it('mengembalikan daftar kosong saat keluaran bukan JSON valid', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(callLLM).mockResolvedValue('maaf saya tidak paham')
    const topics = await classifyAllTopics('pesan')
    expect(topics).toEqual([])
    expect(logged).toHaveBeenCalled()
    logged.mockRestore()
  })

  it('mengembalikan daftar kosong saat topics bukan array', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(callLLM).mockResolvedValue('{"topics":"payment"}')
    const topics = await classifyAllTopics('pesan')
    expect(topics).toEqual([])
    logged.mockRestore()
  })

  it('meneruskan model opsional ke callLLM', async () => {
    vi.mocked(callLLM).mockResolvedValue('{"topics":[]}')
    await classifyAllTopics('pesan', 'gemma4:31b-cloud')
    expect(vi.mocked(callLLM)).toHaveBeenCalledWith(
      'pesan',
      expect.objectContaining({ model: 'gemma4:31b-cloud' })
    )
  })
})

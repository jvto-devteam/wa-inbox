import { describe, it, expect, vi, beforeEach } from 'vitest'
import { recommendTemplates } from './template-recommender'
import { callLLM } from './llm'

vi.mock('./llm', () => ({ callLLM: vi.fn() }))

const templates = [
  { id: 'tpl_1', name: 'Cara Booking', body: 'Ikuti panduan booking di link ini...' },
  { id: 'tpl_2', name: 'Harga Paket', body: 'Berikut harga paket kami...' },
  { id: 'tpl_3', name: 'Jam Operasional', body: 'Kami buka setiap hari...' },
]

beforeEach(() => vi.mocked(callLLM).mockReset())

describe('recommendTemplates', () => {
  it('returns the recommendations the model picked, resolved against the real template objects', async () => {
    vi.mocked(callLLM).mockResolvedValue(
      JSON.stringify({
        recommendations: [
          { templateId: 'tpl_2', reason: 'Pelanggan menanyakan harga paket' },
          { templateId: 'tpl_1', reason: 'Pelanggan baru, mungkin perlu panduan booking' },
        ],
      })
    )

    const result = await recommendTemplates('Berapa harga paket ke Ijen?', templates, 'gemma4:31b-cloud')

    expect(result).toEqual([
      { templateId: 'tpl_2', templateName: 'Harga Paket', reason: 'Pelanggan menanyakan harga paket' },
      { templateId: 'tpl_1', templateName: 'Cara Booking', reason: 'Pelanggan baru, mungkin perlu panduan booking' },
    ])
  })

  it('passes the inbound message as the prompt and the template list + instructions as the system message', async () => {
    vi.mocked(callLLM).mockResolvedValue('{"recommendations":[]}')

    await recommendTemplates('Berapa harga paket ke Ijen?', templates, 'gemma4:31b-cloud')

    expect(callLLM).toHaveBeenCalledWith(
      'Berapa harga paket ke Ijen?',
      expect.objectContaining({
        model: 'gemma4:31b-cloud',
        system: expect.stringContaining('tpl_2'),
      })
    )
  })

  it('strips a ```json code fence before parsing', async () => {
    vi.mocked(callLLM).mockResolvedValue('```json\n{"recommendations":[{"templateId":"tpl_1","reason":"cocok"}]}\n```')

    const result = await recommendTemplates('halo', templates)

    expect(result).toEqual([{ templateId: 'tpl_1', templateName: 'Cara Booking', reason: 'cocok' }])
  })

  it('drops a recommendation whose templateId does not match any real template (hallucinated id)', async () => {
    vi.mocked(callLLM).mockResolvedValue(
      JSON.stringify({ recommendations: [{ templateId: 'tpl_does_not_exist', reason: 'x' }, { templateId: 'tpl_1', reason: 'cocok' }] })
    )

    const result = await recommendTemplates('halo', templates)

    expect(result).toEqual([{ templateId: 'tpl_1', templateName: 'Cara Booking', reason: 'cocok' }])
  })

  it('drops a recommendation with a blank reason', async () => {
    vi.mocked(callLLM).mockResolvedValue(JSON.stringify({ recommendations: [{ templateId: 'tpl_1', reason: '   ' }] }))

    const result = await recommendTemplates('halo', templates)

    expect(result).toEqual([])
  })

  it('caps the result at 3 recommendations even if the model returns more', async () => {
    vi.mocked(callLLM).mockResolvedValue(
      JSON.stringify({
        recommendations: [
          { templateId: 'tpl_1', reason: 'a' },
          { templateId: 'tpl_2', reason: 'b' },
          { templateId: 'tpl_3', reason: 'c' },
          { templateId: 'tpl_1', reason: 'd' },
        ],
      })
    )

    const result = await recommendTemplates('halo', templates)

    expect(result).toHaveLength(3)
  })

  it('returns an empty list rather than throwing when the model recommends nothing relevant', async () => {
    vi.mocked(callLLM).mockResolvedValue('{"recommendations":[]}')
    expect(await recommendTemplates('halo', templates)).toEqual([])
  })

  it('returns an empty list immediately without calling the LLM when there are no templates to recommend from', async () => {
    const result = await recommendTemplates('halo', [])
    expect(result).toEqual([])
    expect(callLLM).not.toHaveBeenCalled()
  })

  it('throws a clear error when the model returns non-JSON garbage, rather than silently returning empty', async () => {
    vi.mocked(callLLM).mockResolvedValue('Maaf, saya tidak yakin template mana yang cocok.')
    await expect(recommendTemplates('halo', templates)).rejects.toThrow('Model tidak mengembalikan JSON yang valid')
  })

  it('returns an empty list when the JSON parses but has no recommendations array', async () => {
    vi.mocked(callLLM).mockResolvedValue('{"foo":"bar"}')
    expect(await recommendTemplates('halo', templates)).toEqual([])
  })
})

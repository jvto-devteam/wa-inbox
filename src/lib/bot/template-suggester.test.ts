import { describe, it, expect, vi, beforeEach } from 'vitest'
import { suggestTemplates } from './template-suggester'
import { callLLM } from './llm'

vi.mock('./llm', () => ({ callLLM: vi.fn() }))

beforeEach(() => vi.mocked(callLLM).mockReset())

const messages = [
  'Berapa harga paket ke Ijen?',
  'Kalau ke Bromo berapa harganya ya?',
  'Harga paket Bromo Ijen berapa min?',
]

describe('suggestTemplates', () => {
  it('returns validated suggestions from the model, including variables and bindings', async () => {
    vi.mocked(callLLM).mockResolvedValue(
      JSON.stringify({
        suggestions: [
          {
            name: 'info_harga_paket',
            body: 'Halo {{1}}, harga paket kami mulai dari Rp1.500.000, sisa tagihan Anda saat ini {{2}}.',
            variables: [
              { name: 'nama', bindingKey: 'contactName' },
              { name: 'sisa', bindingKey: 'financialBalance' },
            ],
            reason: 'Banyak pelanggan menanyakan harga paket',
          },
        ],
      })
    )

    const result = await suggestTemplates(messages, 'gemma4:31b-cloud')

    expect(result).toEqual([
      {
        name: 'info_harga_paket',
        body: 'Halo {{1}}, harga paket kami mulai dari Rp1.500.000, sisa tagihan Anda saat ini {{2}}.',
        variables: [
          { name: 'nama', bindingKey: 'contactName' },
          { name: 'sisa', bindingKey: 'financialBalance' },
        ],
        reason: 'Banyak pelanggan menanyakan harga paket',
      },
    ])
  })

  it('passes the sampled messages and the analysis instructions to the LLM', async () => {
    vi.mocked(callLLM).mockResolvedValue('{"suggestions":[]}')

    await suggestTemplates(messages, 'gemma4:31b-cloud')

    expect(callLLM).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        model: 'gemma4:31b-cloud',
        system: expect.stringContaining('Berapa harga paket ke Ijen?'),
      })
    )
  })

  it('strips a ```json code fence before parsing', async () => {
    vi.mocked(callLLM).mockResolvedValue(
      '```json\n{"suggestions":[{"name":"x","body":"y {{1}}","variables":[{"name":"nama","bindingKey":null}],"reason":"z"}]}\n```'
    )

    const result = await suggestTemplates(messages)

    expect(result).toEqual([{ name: 'x', body: 'y {{1}}', variables: [{ name: 'nama', bindingKey: null }], reason: 'z' }])
  })

  it('normalizes a hallucinated/unknown bindingKey to null rather than keeping an invalid key', async () => {
    vi.mocked(callLLM).mockResolvedValue(
      JSON.stringify({
        suggestions: [{ name: 'x', body: 'y {{1}}', variables: [{ name: 'nama', bindingKey: 'not_a_real_key' }], reason: 'z' }],
      })
    )

    const result = await suggestTemplates(messages)

    expect(result[0].variables[0].bindingKey).toBeNull()
  })

  it('drops a suggestion missing a required field (name, body, or reason)', async () => {
    vi.mocked(callLLM).mockResolvedValue(
      JSON.stringify({
        suggestions: [
          { name: '', body: 'y', variables: [], reason: 'z' },
          { name: 'x', body: '', variables: [], reason: 'z' },
          { name: 'x', body: 'y', variables: [], reason: '' },
        ],
      })
    )

    expect(await suggestTemplates(messages)).toEqual([])
  })

  it('drops a variable entry with no name, without dropping the whole suggestion', async () => {
    vi.mocked(callLLM).mockResolvedValue(
      JSON.stringify({
        suggestions: [{ name: 'x', body: 'y {{1}}', variables: [{ name: '', bindingKey: 'contactName' }, { name: 'nama' }], reason: 'z' }],
      })
    )

    const result = await suggestTemplates(messages)

    expect(result[0].variables).toEqual([{ name: 'nama', bindingKey: null }])
  })

  it('caps the result at 5 suggestions even if the model returns more', async () => {
    vi.mocked(callLLM).mockResolvedValue(
      JSON.stringify({
        suggestions: Array.from({ length: 8 }, (_, i) => ({ name: `t${i}`, body: 'y', variables: [], reason: 'z' })),
      })
    )

    expect(await suggestTemplates(messages)).toHaveLength(5)
  })

  it('returns an empty list immediately without calling the LLM when there are no messages to analyze', async () => {
    const result = await suggestTemplates([])
    expect(result).toEqual([])
    expect(callLLM).not.toHaveBeenCalled()
  })

  it('throws a clear error when the model returns non-JSON garbage', async () => {
    vi.mocked(callLLM).mockResolvedValue('Maaf, tidak ada pola yang jelas.')
    await expect(suggestTemplates(messages)).rejects.toThrow('Model tidak mengembalikan JSON yang valid')
  })

  it('returns an empty list when the JSON parses but has no suggestions array', async () => {
    vi.mocked(callLLM).mockResolvedValue('{"foo":"bar"}')
    expect(await suggestTemplates(messages)).toEqual([])
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { detectsPreferenceDeclineViaLLM } from './preference-decline-classifier'
import { callLLM } from './llm'

vi.mock('./llm', () => ({ callLLM: vi.fn() }))

beforeEach(() => vi.mocked(callLLM).mockReset())

const regexFallback = (message: string) => message.toLowerCase().includes('gak tau')

describe('detectsPreferenceDeclineViaLLM', () => {
  it('detects an explicit decline signal', async () => {
    vi.mocked(callLLM).mockResolvedValue(JSON.stringify({ declined: true }))
    const result = await detectsPreferenceDeclineViaLLM('no idea honestly, you know the routes better than we do', regexFallback, 'gemma4:31b-cloud')
    expect(result).toEqual({ declined: true, source: 'llm' })
  })

  it('does not treat an actual answer as a decline', async () => {
    vi.mocked(callLLM).mockResolvedValue(JSON.stringify({ declined: false }))
    const result = await detectsPreferenceDeclineViaLLM('3 days, starting from Surabaya', regexFallback, 'gemma4:31b-cloud')
    expect(result).toEqual({ declined: false, source: 'llm' })
  })

  it('does not treat an unrelated "whatever" as a preference decline', async () => {
    vi.mocked(callLLM).mockResolvedValue(JSON.stringify({ declined: false }))
    const result = await detectsPreferenceDeclineViaLLM("whatever's included in the package is fine with us", regexFallback, 'gemma4:31b-cloud')
    expect(result.declined).toBe(false)
  })

  it('falls back to the provided regex check when the response is not valid JSON', async () => {
    vi.mocked(callLLM).mockResolvedValue('not json')
    const result = await detectsPreferenceDeclineViaLLM('gak tau juga sih', regexFallback, 'gemma4:31b-cloud')
    expect(result).toEqual({ declined: true, source: 'regex_fallback' })
  })

  it('falls back to the provided regex check when callLLM throws', async () => {
    vi.mocked(callLLM).mockRejectedValueOnce(new Error('timeout'))
    const result = await detectsPreferenceDeclineViaLLM('completely unrelated message', regexFallback, 'gemma4:31b-cloud')
    expect(result).toEqual({ declined: false, source: 'regex_fallback' })
  })

  it('sends the raw customer text as the untrusted prompt, and the decline instructions as system', async () => {
    vi.mocked(callLLM).mockResolvedValue(JSON.stringify({ declined: false }))
    await detectsPreferenceDeclineViaLLM('some message', regexFallback, 'gemma4:31b-cloud')
    expect(callLLM).toHaveBeenCalledWith(
      'some message',
      expect.objectContaining({ model: 'gemma4:31b-cloud', system: expect.stringContaining("DON'T KNOW or DON'T CARE") })
    )
  })
})

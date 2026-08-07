import { describe, it, expect, vi, beforeEach } from 'vitest'
import { detectsRecommendationIntentViaLLM } from './recommendation-intent-classifier'
import { callLLM } from './llm'

vi.mock('./llm', () => ({ callLLM: vi.fn() }))

beforeEach(() => vi.mocked(callLLM).mockReset())

const regexFallback = (message: string) => /\brecommend\w*\b.{0,25}\b(package|tour)\b/.test(message.toLowerCase())

describe('detectsRecommendationIntentViaLLM', () => {
  // Reported live: a genuine recommendation request with none of the regex's trigger words.
  it('detects a genuine recommendation request with no literal trigger keywords', async () => {
    vi.mocked(callLLM).mockResolvedValue(JSON.stringify({ isRecommendation: true }))
    const result = await detectsRecommendationIntentViaLLM("We're 4 people, no idea where to go -- what would be best for us?", regexFallback, 'gemma4:31b-cloud')
    expect(result).toEqual({ isRecommendation: true, source: 'llm' })
  })

  it('does not treat a bare "options"/"recommend" mention in an unrelated context as recommendation intent', async () => {
    vi.mocked(callLLM).mockResolvedValue(JSON.stringify({ isRecommendation: false }))
    const result = await detectsRecommendationIntentViaLLM('What are my options if I have to cancel due to a flight delay?', regexFallback, 'gemma4:31b-cloud')
    expect(result.isRecommendation).toBe(false)
  })

  it('detects an ordinary explicit recommendation request', async () => {
    vi.mocked(callLLM).mockResolvedValue(JSON.stringify({ isRecommendation: true }))
    const result = await detectsRecommendationIntentViaLLM('Which package do you recommend for Ijen?', regexFallback, 'gemma4:31b-cloud')
    expect(result.isRecommendation).toBe(true)
  })

  it('falls back to the provided regex check when the response is not valid JSON', async () => {
    vi.mocked(callLLM).mockResolvedValue('not json')
    const result = await detectsRecommendationIntentViaLLM('please recommend a package for us', regexFallback, 'gemma4:31b-cloud')
    expect(result).toEqual({ isRecommendation: true, source: 'regex_fallback' })
  })

  it('falls back to the provided regex check when callLLM throws', async () => {
    vi.mocked(callLLM).mockRejectedValueOnce(new Error('timeout'))
    const result = await detectsRecommendationIntentViaLLM('completely unrelated message', regexFallback, 'gemma4:31b-cloud')
    expect(result).toEqual({ isRecommendation: false, source: 'regex_fallback' })
  })

  it('sends the raw customer text as the untrusted prompt, and the intent instructions as system', async () => {
    vi.mocked(callLLM).mockResolvedValue(JSON.stringify({ isRecommendation: false }))
    await detectsRecommendationIntentViaLLM('some message', regexFallback, 'gemma4:31b-cloud')
    expect(callLLM).toHaveBeenCalledWith(
      'some message',
      expect.objectContaining({ model: 'gemma4:31b-cloud', system: expect.stringContaining('HELP CHOOSING a tour package') })
    )
  })
})

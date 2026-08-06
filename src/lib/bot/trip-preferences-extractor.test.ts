import { describe, it, expect, vi, beforeEach } from 'vitest'
import { extractTripPreferences } from './trip-preferences-extractor'
import { parseTripPreferences } from './package-match'
import { callLLM } from './llm'

// package-match.ts is NOT mocked -- the fallback tests need the genuine regex behavior, same
// rationale as orchestrator.real.test.ts's "leave the real parsing pipeline running" approach.
vi.mock('./llm', () => ({ callLLM: vi.fn() }))

beforeEach(() => vi.mocked(callLLM).mockReset())

describe('extractTripPreferences', () => {
  // Reported live 2026-08-07: this exact message never matched any regex pattern
  // (parseDayCount only looked for "N days"/"NDMN", parseFinishCity was gated behind a literal
  // phrase whitelist that "continue...to Bali" isn't in) -- the whole reason this LLM-primary
  // extractor exists.
  it('extracts the real customer message that motivated this feature (Day-N headers + implicit "continue...to Bali")', async () => {
    const message =
      'Day 1\nAirport pickup in Surabaya\nDay 2\nTumpak Sewu Waterfall\nDay 3\nMount Bromo Sunrise Tour\n' +
      'Day 4\nKawah Ijen, Transfer to Ketapang Ferry Port\nAfter taking the ferry, we will continue our trip independently to Bali.'
    vi.mocked(callLLM).mockResolvedValue(JSON.stringify({ origin: null, dayCount: 4, finishCity: 'bali', pax: null }))

    const result = await extractTripPreferences(message, 'gemma4:31b-cloud')

    expect(result).toEqual({ preferences: { origin: null, dayCount: 4, finishCity: 'bali', pax: null }, source: 'llm' })
  })

  it('extracts a valid origin', async () => {
    vi.mocked(callLLM).mockResolvedValue(JSON.stringify({ origin: 'Bali', dayCount: null, finishCity: null, pax: null }))
    const result = await extractTripPreferences('starting from Bali', 'gemma4:31b-cloud')
    expect(result.preferences.origin).toBe('Bali')
    expect(result.source).toBe('llm')
  })

  it('extracts a valid dayCount', async () => {
    vi.mocked(callLLM).mockResolvedValue(JSON.stringify({ origin: null, dayCount: 5, finishCity: null, pax: null }))
    const result = await extractTripPreferences('a 5 day trip please', 'gemma4:31b-cloud')
    expect(result.preferences.dayCount).toBe(5)
  })

  it('extracts a valid finishCity', async () => {
    vi.mocked(callLLM).mockResolvedValue(JSON.stringify({ origin: null, dayCount: null, finishCity: 'malang', pax: null }))
    const result = await extractTripPreferences('can we end in Malang?', 'gemma4:31b-cloud')
    expect(result.preferences.finishCity).toBe('malang')
  })

  it('extracts a valid pax, including implicit signals like "my girlfriend and I"', async () => {
    vi.mocked(callLLM).mockResolvedValue(JSON.stringify({ origin: null, dayCount: null, finishCity: null, pax: 2 }))
    const result = await extractTripPreferences('my girlfriend and I are planning a trip', 'gemma4:31b-cloud')
    expect(result.preferences.pax).toBe(2)
  })

  it('discards a hallucinated origin city not in the known Bali/Surabaya set', async () => {
    vi.mocked(callLLM).mockResolvedValue(JSON.stringify({ origin: 'Jakarta', dayCount: null, finishCity: null, pax: null }))
    const result = await extractTripPreferences('from Jakarta', 'gemma4:31b-cloud')
    expect(result.preferences.origin).toBeNull()
    expect(result.source).toBe('llm')
  })

  it('discards an out-of-range dayCount', async () => {
    vi.mocked(callLLM).mockResolvedValue(JSON.stringify({ origin: null, dayCount: 45, finishCity: null, pax: null }))
    const result = await extractTripPreferences('a 45 day trip', 'gemma4:31b-cloud')
    expect(result.preferences.dayCount).toBeNull()
  })

  it('discards a non-numeric dayCount', async () => {
    vi.mocked(callLLM).mockResolvedValue(JSON.stringify({ origin: null, dayCount: 'three', finishCity: null, pax: null }))
    const result = await extractTripPreferences('a three day trip', 'gemma4:31b-cloud')
    expect(result.preferences.dayCount).toBeNull()
  })

  it('discards a hallucinated finishCity not in the known 4-city set', async () => {
    vi.mocked(callLLM).mockResolvedValue(JSON.stringify({ origin: null, dayCount: null, finishCity: 'yogyakarta', pax: null }))
    const result = await extractTripPreferences('end in Yogyakarta', 'gemma4:31b-cloud')
    expect(result.preferences.finishCity).toBeNull()
  })

  it('discards an out-of-range pax', async () => {
    vi.mocked(callLLM).mockResolvedValue(JSON.stringify({ origin: null, dayCount: null, finishCity: null, pax: 9999 }))
    const result = await extractTripPreferences('a huge group', 'gemma4:31b-cloud')
    expect(result.preferences.pax).toBeNull()
  })

  it('falls back to the real regex parser when the LLM response is not valid JSON', async () => {
    vi.mocked(callLLM).mockResolvedValue('not json at all')
    const message = '3 days start surabaya finish bali'

    const result = await extractTripPreferences(message, 'gemma4:31b-cloud')

    expect(result).toEqual({ preferences: parseTripPreferences(message), source: 'regex_fallback' })
    expect(result.preferences).toEqual({ origin: 'Surabaya', dayCount: 3, finishCity: 'bali', pax: null })
  })

  it('falls back to the regex parser when the JSON is well-formed but missing the expected keys', async () => {
    vi.mocked(callLLM).mockResolvedValue(JSON.stringify({ foo: 'bar' }))
    const message = '3 days start surabaya finish bali'

    const result = await extractTripPreferences(message, 'gemma4:31b-cloud')

    expect(result).toEqual({ preferences: parseTripPreferences(message), source: 'regex_fallback' })
  })

  it('falls back to the regex parser when callLLM throws (e.g. a timeout)', async () => {
    // mockRejectedValueOnce specifically -- mockRejectedValue/mockImplementation-that-throws
    // trip a Vitest module-mock quirk where the rejection is reported as an unhandled test
    // failure even though it's genuinely caught by extractTripPreferences' own try/catch
    // (confirmed by direct repro: identical behavior with a plain vi.mock('./llm', ...) factory
    // outside this file too -- mockRejectedValueOnce is the one variant that doesn't trigger it).
    vi.mocked(callLLM).mockRejectedValueOnce(new Error('timeout'))
    const message = '3 days start surabaya finish bali'

    const result = await extractTripPreferences(message, 'gemma4:31b-cloud')

    expect(result).toEqual({ preferences: parseTripPreferences(message), source: 'regex_fallback' })
  })

  it('strips a ```json code fence before parsing', async () => {
    vi.mocked(callLLM).mockResolvedValue('```json\n{"origin":"Surabaya","dayCount":null,"finishCity":null,"pax":null}\n```')
    const result = await extractTripPreferences('from Surabaya', 'gemma4:31b-cloud')
    expect(result).toEqual({ preferences: { origin: 'Surabaya', dayCount: null, finishCity: null, pax: null }, source: 'llm' })
  })

  it('sends the raw customer text as the untrusted prompt, and the extraction instructions as system', async () => {
    vi.mocked(callLLM).mockResolvedValue(JSON.stringify({ origin: null, dayCount: null, finishCity: null, pax: null }))

    await extractTripPreferences('some customer message', 'gemma4:31b-cloud')

    expect(callLLM).toHaveBeenCalledWith(
      'some customer message',
      expect.objectContaining({ model: 'gemma4:31b-cloud', system: expect.stringContaining('extract 4 trip-planning fields') })
    )
  })
})

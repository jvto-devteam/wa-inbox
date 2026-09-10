import { describe, it, expect, vi, beforeEach } from 'vitest'
import { classifyTopicViaLLM } from './topic-classifier'
import { classifyTopic } from './module-resolver'
import { callLLM } from './llm'

// module-resolver.ts is NOT mocked -- the fallback tests need the genuine regex behavior, same
// rationale as trip-preferences-extractor.test.ts.
vi.mock('./llm', () => ({ callLLM: vi.fn() }))

beforeEach(() => vi.mocked(callLLM).mockReset())

describe('classifyTopicViaLLM', () => {
  // Reported live 2026-08-04 (the bug that motivated payment being reordered ahead of price in
  // the regex fallback): "how much is the deposit and when do I pay?" classified as 'price'
  // under a pure keyword scan, because "how much" is checked first. An LLM reading the whole
  // message for meaning should get this right without needing keyword-order tuning.
  it('classifies a deposit/payment question as "payment", not "price"', async () => {
    vi.mocked(callLLM).mockResolvedValue(JSON.stringify({ topic: 'payment' }))
    const result = await classifyTopicViaLLM('J1', 'how much is the deposit and when do I pay?', 'gemma4:31b-cloud')
    expect(result).toEqual({ topic: 'payment', alsoTopics: [], source: 'llm' })
  })

  // Reported live 2026-08-05: "...Mount Ijen and after transfer to Bali... are there guaranteed
  // private double rooms?" classified as 'payment' (bare "transfer" matched the travel sense),
  // silently losing the real 'rooming' topic.
  it('classifies a rooming question mentioning "transfer" (travel sense) as "rooming", not "payment"', async () => {
    vi.mocked(callLLM).mockResolvedValue(JSON.stringify({ topic: 'rooming' }))
    const result = await classifyTopicViaLLM('J1', '...Mount Ijen and after transfer to Bali... are there guaranteed private double rooms?', 'gemma4:31b-cloud')
    expect(result.topic).toBe('rooming')
  })

  it('discards a hallucinated topic not in the real 14-topic set', async () => {
    vi.mocked(callLLM).mockResolvedValue(JSON.stringify({ topic: 'weather' }))
    const result = await classifyTopicViaLLM('J1', 'what is the weather like?', 'gemma4:31b-cloud')
    // Falls back to the real regex classifier -- an invalid topic value is treated as a
    // technical failure, not trusted as "general".
    expect(result.source).toBe('regex_fallback')
    expect(result.topic).toBe(classifyTopic('J1', 'what is the weather like?'))
  })

  it('falls back to the real regex classifier when the response is not valid JSON', async () => {
    vi.mocked(callLLM).mockResolvedValue('not json')
    const message = 'how much for 4 people?'
    const result = await classifyTopicViaLLM('J2', message, 'gemma4:31b-cloud')
    expect(result).toEqual({ topic: classifyTopic('J2', message), alsoTopics: [], source: 'regex_fallback' })
  })

  it('falls back to the real regex classifier when callLLM throws', async () => {
    vi.mocked(callLLM).mockRejectedValueOnce(new Error('timeout'))
    const message = 'how much for 4 people?'
    const result = await classifyTopicViaLLM('J2', message, 'gemma4:31b-cloud')
    expect(result).toEqual({ topic: classifyTopic('J2', message), alsoTopics: [], source: 'regex_fallback' })
  })

  it('falls back to the job-default topic (via the real regex classifier) when nothing matches at all', async () => {
    vi.mocked(callLLM).mockResolvedValue('garbage')
    const result = await classifyTopicViaLLM('J4', 'asdkfjaslkdfj', 'gemma4:31b-cloud')
    expect(result).toEqual({ topic: 'booking', alsoTopics: [], source: 'regex_fallback' })
  })

  it('sends the raw customer text as the untrusted prompt, and the classification instructions as system', async () => {
    vi.mocked(callLLM).mockResolvedValue(JSON.stringify({ topic: 'general' }))
    await classifyTopicViaLLM('J1', 'some customer message', 'gemma4:31b-cloud')
    expect(callLLM).toHaveBeenCalledWith(
      'some customer message',
      expect.objectContaining({ model: 'gemma4:31b-cloud', system: expect.stringContaining('classify a customer') })
    )
  })
})

// Task 21 (Ruling R65): a message can genuinely ask about more than one topic at once
// ("what's the deposit, and can you drop us off in Malang?"). One classifier call now asks for
// an optional `also` field alongside the existing `topic` field, so a second real topic doesn't
// silently vanish behind the topic gate (see runtime-integration.ts's managedFactsFor). `also`
// is validated the same way `topic` always has been -- against the real 14-topic enum -- but a
// bad/missing `also` must NEVER invalidate an otherwise-good primary `topic`.
describe('classifyTopicViaLLM -- also (topik tambahan, Ruling R65)', () => {
  it('accepts a valid also-topic distinct from the primary', async () => {
    vi.mocked(callLLM).mockResolvedValue(JSON.stringify({ topic: 'payment', also: ['route_endpoint'] }))
    const result = await classifyTopicViaLLM('J1', "what's the deposit, and can you drop us off in Malang?", 'gemma4:31b-cloud')
    expect(result).toEqual({ topic: 'payment', alsoTopics: ['route_endpoint'], source: 'llm' })
  })

  it('drops an also-topic that is not one of the real 14 topics', async () => {
    vi.mocked(callLLM).mockResolvedValue(JSON.stringify({ topic: 'payment', also: ['weather'] }))
    const result = await classifyTopicViaLLM('J1', 'some message', 'gemma4:31b-cloud')
    expect(result).toEqual({ topic: 'payment', alsoTopics: [], source: 'llm' })
  })

  it('deduplicates a repeated also-topic', async () => {
    vi.mocked(callLLM).mockResolvedValue(JSON.stringify({ topic: 'payment', also: ['route_endpoint', 'route_endpoint'] }))
    const result = await classifyTopicViaLLM('J1', 'some message', 'gemma4:31b-cloud')
    expect(result).toEqual({ topic: 'payment', alsoTopics: ['route_endpoint'], source: 'llm' })
  })

  it('drops an also-topic equal to the primary topic', async () => {
    vi.mocked(callLLM).mockResolvedValue(JSON.stringify({ topic: 'payment', also: ['payment'] }))
    const result = await classifyTopicViaLLM('J1', 'some message', 'gemma4:31b-cloud')
    expect(result).toEqual({ topic: 'payment', alsoTopics: [], source: 'llm' })
  })

  it('caps also-topics at 2, keeping the first two valid ones in order', async () => {
    vi.mocked(callLLM).mockResolvedValue(
      JSON.stringify({ topic: 'payment', also: ['route_endpoint', 'hotel', 'vehicle'] })
    )
    const result = await classifyTopicViaLLM('J1', 'some message', 'gemma4:31b-cloud')
    expect(result).toEqual({ topic: 'payment', alsoTopics: ['route_endpoint', 'hotel'], source: 'llm' })
  })

  it('treats a missing also field as an empty list', async () => {
    vi.mocked(callLLM).mockResolvedValue(JSON.stringify({ topic: 'payment' }))
    const result = await classifyTopicViaLLM('J1', 'some message', 'gemma4:31b-cloud')
    expect(result).toEqual({ topic: 'payment', alsoTopics: [], source: 'llm' })
  })

  it('keeps a good primary topic even when also is malformed (not an array)', async () => {
    vi.mocked(callLLM).mockResolvedValue(JSON.stringify({ topic: 'payment', also: 'route_endpoint' }))
    const result = await classifyTopicViaLLM('J1', 'some message', 'gemma4:31b-cloud')
    expect(result).toEqual({ topic: 'payment', alsoTopics: [], source: 'llm' })
  })

  it('the regex_fallback path always returns an empty alsoTopics, even from a genuine multi-topic message', async () => {
    vi.mocked(callLLM).mockResolvedValue('garbage')
    const result = await classifyTopicViaLLM('J1', "what's the deposit, and can you drop us off in Malang?", 'gemma4:31b-cloud')
    expect(result.source).toBe('regex_fallback')
    expect(result.alsoTopics).toEqual([])
  })
})

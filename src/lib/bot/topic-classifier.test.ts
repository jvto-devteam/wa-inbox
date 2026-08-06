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
    expect(result).toEqual({ topic: 'payment', source: 'llm' })
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
    expect(result).toEqual({ topic: classifyTopic('J2', message), source: 'regex_fallback' })
  })

  it('falls back to the real regex classifier when callLLM throws', async () => {
    vi.mocked(callLLM).mockRejectedValueOnce(new Error('timeout'))
    const message = 'how much for 4 people?'
    const result = await classifyTopicViaLLM('J2', message, 'gemma4:31b-cloud')
    expect(result).toEqual({ topic: classifyTopic('J2', message), source: 'regex_fallback' })
  })

  it('falls back to the job-default topic (via the real regex classifier) when nothing matches at all', async () => {
    vi.mocked(callLLM).mockResolvedValue('garbage')
    const result = await classifyTopicViaLLM('J4', 'asdkfjaslkdfj', 'gemma4:31b-cloud')
    expect(result).toEqual({ topic: 'booking', source: 'regex_fallback' })
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

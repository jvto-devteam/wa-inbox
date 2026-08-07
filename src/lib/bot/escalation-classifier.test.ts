import { describe, it, expect, vi, beforeEach } from 'vitest'
import { detectsAdditionalEscalationSignal } from './escalation-classifier'
import { callLLM } from './llm'

vi.mock('./llm', () => ({ callLLM: vi.fn() }))

beforeEach(() => vi.mocked(callLLM).mockReset())

describe('detectsAdditionalEscalationSignal', () => {
  it('returns true for a genuine complaint the LLM detects', async () => {
    vi.mocked(callLLM).mockResolvedValue(JSON.stringify({ escalate: true }))
    const result = await detectsAdditionalEscalationSignal('I am a bit disappointed because the extra service I paid for never showed up', 'gemma4:31b-cloud')
    expect(result).toBe(true)
  })

  it('returns false for an ordinary answerable question', async () => {
    vi.mocked(callLLM).mockResolvedValue(JSON.stringify({ escalate: false }))
    const result = await detectsAdditionalEscalationSignal('How do I cancel my booking?', 'gemma4:31b-cloud')
    expect(result).toBe(false)
  })

  it('fails safe to false when the response is not valid JSON', async () => {
    vi.mocked(callLLM).mockResolvedValue('not json')
    const result = await detectsAdditionalEscalationSignal('some message', 'gemma4:31b-cloud')
    expect(result).toBe(false)
  })

  it('fails safe to false when the JSON has the wrong shape', async () => {
    vi.mocked(callLLM).mockResolvedValue(JSON.stringify({ foo: 'bar' }))
    const result = await detectsAdditionalEscalationSignal('some message', 'gemma4:31b-cloud')
    expect(result).toBe(false)
  })

  it('fails safe to false when callLLM throws (e.g. a timeout)', async () => {
    vi.mocked(callLLM).mockRejectedValueOnce(new Error('timeout'))
    const result = await detectsAdditionalEscalationSignal('some message', 'gemma4:31b-cloud')
    expect(result).toBe(false)
  })

  it('sends the raw customer text as the untrusted prompt, and the escalation instructions as system', async () => {
    vi.mocked(callLLM).mockResolvedValue(JSON.stringify({ escalate: false }))
    await detectsAdditionalEscalationSignal('some customer message', 'gemma4:31b-cloud')
    expect(callLLM).toHaveBeenCalledWith(
      'some customer message',
      expect.objectContaining({ model: 'gemma4:31b-cloud', system: expect.stringContaining('a HUMAN must handle this') })
    )
  })
})

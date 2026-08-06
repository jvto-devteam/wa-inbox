import { describe, it, expect, vi, beforeEach } from 'vitest'
import { classifyKeywordModulesViaLLM, keywordTriggeredFactsViaLLM } from './keyword-module-classifier'
import { hasKeywordTriggeredModule, __resetKnowledgeCacheForTests } from './knowledge'
import { callLLM } from './llm'
import { readCatalogFile } from './catalog'

// knowledge.ts is NOT mocked -- the fallback tests need the genuine regex behavior, same
// rationale as trip-preferences-extractor.test.ts / topic-classifier.test.ts.
vi.mock('./llm', () => ({ callLLM: vi.fn() }))
vi.mock('./catalog', () => ({ readCatalogFile: vi.fn() }))

const MODULES = [
  { module_id: 'policy_emergency_and_support', short_answer: 'A backup vehicle and driver are always on standby.', customer_visible: true, approval_status: 'approved' },
  { module_id: 'policy_ijen_crater_access_status', short_answer: 'Crater access is currently closed; the summit hike is still open.', customer_visible: true, approval_status: 'approved' },
  { module_id: 'service_dietary_preference_noted', short_answer: 'Noted -- we will flag this to your guide.', customer_visible: true, approval_status: 'approved' },
]

beforeEach(() => {
  vi.mocked(callLLM).mockReset()
  __resetKnowledgeCacheForTests()
  vi.mocked(readCatalogFile).mockImplementation((file: string) => {
    if (file === 'general-modules.json') return MODULES as never
    if (file === 'customer-link-registry.json') return { links: [] } as never
    return null
  })
})

describe('classifyKeywordModulesViaLLM', () => {
  // Reported live 2026-08-05: "If the driver or vehicle breaks down during the tour, is there
  // a backup unit ready?" matched none of the original literal keyword phrases at all.
  it('classifies a real "breaks down"/"backup unit" phrasing to policy_emergency_and_support', async () => {
    vi.mocked(callLLM).mockResolvedValue(JSON.stringify({ moduleIds: ['policy_emergency_and_support'] }))
    const result = await classifyKeywordModulesViaLLM('If the driver or vehicle breaks down during the tour, is there a backup unit ready?', 'gemma4:31b-cloud')
    expect(result).toEqual({ moduleIds: ['policy_emergency_and_support'], source: 'llm' })
  })

  it('selects multiple independent triggers from one message', async () => {
    vi.mocked(callLLM).mockResolvedValue(JSON.stringify({ moduleIds: ['service_dietary_preference_noted', 'policy_emergency_and_support'] }))
    const result = await classifyKeywordModulesViaLLM('no beef please, and is there a backup driver just in case?', 'gemma4:31b-cloud')
    expect(result.moduleIds.sort()).toEqual(['policy_emergency_and_support', 'service_dietary_preference_noted'])
  })

  it('returns an empty array when nothing applies', async () => {
    vi.mocked(callLLM).mockResolvedValue(JSON.stringify({ moduleIds: [] }))
    const result = await classifyKeywordModulesViaLLM('how much is the deposit?', 'gemma4:31b-cloud')
    expect(result).toEqual({ moduleIds: [], source: 'llm' })
  })

  it('discards a hallucinated module ID not in the real KEYWORD_TRIGGERED_MODULES set', async () => {
    vi.mocked(callLLM).mockResolvedValue(JSON.stringify({ moduleIds: ['policy_emergency_and_support', 'made_up_module'] }))
    const result = await classifyKeywordModulesViaLLM('backup driver?', 'gemma4:31b-cloud')
    expect(result).toEqual({ moduleIds: ['policy_emergency_and_support'], source: 'llm' })
  })

  it('falls back to the real regex scan when the response is not valid JSON', async () => {
    vi.mocked(callLLM).mockResolvedValue('not json')
    const message = 'blue flames access status?'
    const result = await classifyKeywordModulesViaLLM(message, 'gemma4:31b-cloud')
    expect(result.source).toBe('regex_fallback')
    expect(result.moduleIds).toEqual(['policy_ijen_crater_access_status'])
    expect(hasKeywordTriggeredModule(message)).toBe(true)
  })

  it('falls back to the real regex scan when callLLM throws', async () => {
    vi.mocked(callLLM).mockRejectedValueOnce(new Error('timeout'))
    const result = await classifyKeywordModulesViaLLM('blue flames access status?', 'gemma4:31b-cloud')
    expect(result).toEqual({ moduleIds: ['policy_ijen_crater_access_status'], source: 'regex_fallback' })
  })

  it('falls back to an empty array when the regex scan also finds nothing', async () => {
    vi.mocked(callLLM).mockResolvedValue('not json')
    const result = await classifyKeywordModulesViaLLM('completely unrelated message', 'gemma4:31b-cloud')
    expect(result).toEqual({ moduleIds: [], source: 'regex_fallback' })
  })

  it('sends the raw customer text as the untrusted prompt, and the trigger catalog as system', async () => {
    vi.mocked(callLLM).mockResolvedValue(JSON.stringify({ moduleIds: [] }))
    await classifyKeywordModulesViaLLM('some customer message', 'gemma4:31b-cloud')
    expect(callLLM).toHaveBeenCalledWith(
      'some customer message',
      expect.objectContaining({ model: 'gemma4:31b-cloud', system: expect.stringContaining('policy_emergency_and_support') })
    )
  })
})

describe('keywordTriggeredFactsViaLLM', () => {
  it('resolves real facts for the LLM-selected module IDs', async () => {
    vi.mocked(callLLM).mockResolvedValue(JSON.stringify({ moduleIds: ['policy_emergency_and_support'] }))
    const result = await keywordTriggeredFactsViaLLM('backup driver?', 'gemma4:31b-cloud')
    expect(result.facts).toEqual(['A backup vehicle and driver are always on standby.'])
    expect(result.source).toBe('llm')
  })

  it('resolves real facts via the regex fallback on a technical failure', async () => {
    vi.mocked(callLLM).mockResolvedValue('not json')
    const result = await keywordTriggeredFactsViaLLM('blue flames access status?', 'gemma4:31b-cloud')
    expect(result.facts).toEqual(['Crater access is currently closed; the summit hike is still open.'])
    expect(result.source).toBe('regex_fallback')
  })
})

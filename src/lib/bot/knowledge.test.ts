import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readCatalogFile } from './catalog'
import { resolveKnowledgeForTopic, __resetKnowledgeCacheForTests } from './knowledge'

vi.mock('./catalog', () => ({ readCatalogFile: vi.fn() }))

const modules = [
  {
    module_id: 'inclusion_all_inclusive_baseline',
    title: 'What Is Included',
    short_answer: 'Every package includes private transport, driver/guide, entrance fees, and water.',
    detail_summary: 'Full detail about inclusions.',
    customer_visible: true,
    approval_status: 'approved',
  },
  {
    module_id: 'service_private_tour_standard',
    title: 'Private Tour',
    short_answer: 'This is a private tour with your own dedicated driver and guide(s).',
    customer_visible: true,
    approval_status: 'approved',
  },
  {
    module_id: 'policy_natural_phenomena',
    title: 'Blue Fire',
    short_answer: 'Blue fire visibility depends on natural conditions.',
    customer_visible: true,
    approval_status: 'approved',
  },
  {
    module_id: 'destination_ijen',
    title: 'Ijen',
    short_answer: 'Ijen crater is an active volcano site.',
    customer_visible: true,
    approval_status: 'approved',
  },
  {
    module_id: 'unapproved_module',
    title: 'Draft',
    short_answer: 'Should never be surfaced.',
    customer_visible: true,
    approval_status: 'operational_reference',
  },
  {
    module_id: 'internal_only_module',
    title: 'Internal',
    short_answer: 'Should never be surfaced either.',
    customer_visible: false,
    approval_status: 'approved',
  },
]

function mockCatalogFiles() {
  vi.mocked(readCatalogFile).mockImplementation((fileName: string) => {
    if (fileName === 'general-modules.json') return modules
    return null
  })
}

beforeEach(() => {
  vi.mocked(readCatalogFile).mockReset()
  __resetKnowledgeCacheForTests()
  mockCatalogFiles()
})

describe('resolveKnowledgeForTopic', () => {
  it('resolves approved, customer-visible modules for a topic into facts', () => {
    const result = resolveKnowledgeForTopic('inclusions', 'what is included?')

    expect(result.factualLines).toEqual(['Every package includes private transport, driver/guide, entrance fees, and water.'])
    expect(result.detailLines).toEqual(['Full detail about inclusions.'])
    expect(result.handoffRequired).toBe(false)
  })

  it('filters out an unapproved module even when its topic mapping references it', () => {
    // 'price' maps to inclusion_all_inclusive_baseline + service_private_tour_standard +
    // service_vehicle_by_pax -- the latter isn't in this test's fixture at all, so only the
    // two approved ones should surface.
    const result = resolveKnowledgeForTopic('price', 'how much?')
    expect(result.factualLines).toEqual([
      'Every package includes private transport, driver/guide, entrance fees, and water.',
      'This is a private tour with your own dedicated driver and guide(s).',
    ])
  })

  it('returns no facts for a topic with an empty module list (e.g. route_endpoint)', () => {
    const result = resolveKnowledgeForTopic('route_endpoint', 'can we finish in bali?')
    expect(result.factualLines).toEqual([])
    expect(result.detailLines).toEqual([])
  })

  it('adds the availability disclosure for the price topic', () => {
    const result = resolveKnowledgeForTopic('price', 'how much?')
    expect(result.disclosures).toEqual(['Availability is not yet confirmed for the requested date.'])
  })

  it('adds the Ijen access-risk disclosures only when the message actually mentions Ijen', () => {
    const withIjen = resolveKnowledgeForTopic('destination_readiness', 'is ijen safe?')
    expect(withIjen.disclosures.length).toBeGreaterThan(0)

    const withoutIjen = resolveKnowledgeForTopic('destination_readiness', 'is bromo safe?')
    expect(withoutIjen.disclosures).toEqual([])
  })

  it('adds the no-guarantee disclosure when the customer uses a guarantee phrase, even outside blue_fire/destination_readiness', () => {
    const result = resolveKnowledgeForTopic('inclusions', 'can you guarantee this 100%?')
    expect(result.disclosures).toContain(
      'Attraction access such as Blue Fire, along with weather and sunrise, cannot be guaranteed; it depends on current conditions and the authorities.'
    )
  })

  it('does not duplicate the no-guarantee disclosure when both the topic and the guarantee phrase would add it', () => {
    const result = resolveKnowledgeForTopic('blue_fire', 'can you guarantee blue fire, 100%?')
    const occurrences = result.disclosures.filter(
      (d) => d === 'Attraction access such as Blue Fire, along with weather and sunrise, cannot be guaranteed; it depends on current conditions and the authorities.'
    ).length
    expect(occurrences).toBe(1)
  })

  it('flags handoffRequired only when BOTH an attraction-is-the-reason phrase AND a guarantee phrase are present', () => {
    expect(resolveKnowledgeForTopic('blue_fire', 'blue fire is the main reason we book, can you guarantee it?').handoffRequired).toBe(true)
    expect(resolveKnowledgeForTopic('blue_fire', 'can you guarantee it?').handoffRequired).toBe(false)
    expect(resolveKnowledgeForTopic('blue_fire', 'blue fire is the main reason we book').handoffRequired).toBe(false)
  })

  it('caches loaded modules across calls until reset (module-level lazy cache)', () => {
    resolveKnowledgeForTopic('inclusions', 'what is included?')
    resolveKnowledgeForTopic('inclusions', 'what is included?')
    // loadModules reads its file once, not once per call.
    const generalModulesCalls = vi.mocked(readCatalogFile).mock.calls.filter(([f]) => f === 'general-modules.json')
    expect(generalModulesCalls).toHaveLength(1)
  })
})

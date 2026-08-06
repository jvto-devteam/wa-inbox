import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readCatalogFile } from './catalog'
import {
  resolveKnowledgeForTopic,
  resolveRouteLegFacts,
  __resetKnowledgeCacheForTests,
  GENERAL_FAQ_FALLBACK,
  GUARDRAIL_INSTRUCTION,
} from './knowledge'

vi.mock('./catalog', () => ({ readCatalogFile: vi.fn() }))

const modules = [
  {
    module_id: 'inclusion_all_inclusive_baseline',
    title: 'What Is Included',
    short_answer: 'Every package includes private transport, driver/guide, entrance fees, and water.',
    detail_summary: 'Full detail about inclusions.',
    customer_visible: true,
    approval_status: 'approved',
    link_key: 'what_is_included',
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
    link_key: 'ijen_readiness',
  },
  {
    module_id: 'destination_bromo',
    title: 'Bromo',
    short_answer: 'Bromo is famous for its sunrise viewpoint.',
    customer_visible: true,
    approval_status: 'approved',
    link_key: 'bromo_sunrise',
  },
  {
    module_id: 'inclusion_ijen_equipment',
    title: 'Ijen Equipment',
    short_answer: 'Gas masks and trekking poles for the Ijen crater hike.',
    customer_visible: true,
    approval_status: 'approved',
    variation_trigger: 'ijen',
  },
  {
    module_id: 'inclusion_bromo_private_jeep',
    title: 'Bromo Jeep',
    short_answer: 'Private 4WD jeep for the Bromo Sea of Sand and sunrise viewpoint.',
    customer_visible: true,
    approval_status: 'approved',
    variation_trigger: 'bromo',
  },
  {
    module_id: 'policy_isic_student',
    title: 'ISIC Student Pricing',
    short_answer: 'Student pricing is available to verified ISIC cardholders.',
    customer_visible: true,
    approval_status: 'approved',
    link_key: 'isic_student_pricing',
  },
  {
    module_id: 'policy_police_escort',
    title: 'Police Escort',
    short_answer: 'For large groups, JVTO can coordinate an official police escort.',
    customer_visible: true,
    approval_status: 'approved',
  },
  {
    module_id: 'inclusion_east_java_bali_ferry',
    title: 'Ferry Crossing',
    short_answer: 'Ketapang-Gilimanuk ferry crossing for Bali-linked packages.',
    customer_visible: true,
    approval_status: 'approved',
  },
  {
    module_id: 'route_leg_surabaya_airport_to_bromo_area',
    title: 'Surabaya Airport to Bromo Area',
    short_answer: 'Surabaya Airport to Bromo Area: ±3.5-4.5 hours (operational).',
    customer_visible: true,
    approval_status: 'approved',
  },
  {
    module_id: 'route_leg_bromo_area_to_madakaripura',
    title: 'Bromo Area to Madakaripura',
    short_answer: 'Bromo Area to Madakaripura Waterfall: ±45-60 min drive (+20-30 min canyon walk).',
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

const linkRegistry = {
  base_url: 'https://javavolcano-touroperator.com',
  links: [
    { link_key: 'what_is_included', url: 'https://javavolcano-touroperator.com/policy/inclusions-exclusions', status: 'existing' },
    { link_key: 'ijen_readiness', url: 'https://javavolcano-touroperator.com/destinations/ijen-crater', status: 'existing' },
    { link_key: 'bromo_sunrise', url: 'https://javavolcano-touroperator.com/destinations/mount-bromo', status: 'existing' },
    { link_key: 'isic_student_pricing', url: 'https://javavolcano-touroperator.com/isic/student-package', status: 'existing' },
    // Two different URLs under the same key -> ambiguous, must never be guessed at.
    { link_key: 'ambiguous_key', url: 'https://example.com/a', status: 'existing' },
    { link_key: 'ambiguous_key', url: 'https://example.com/b', status: 'existing' },
    { link_key: 'not_yet_live', url: null, status: 'prefill_unverified' },
  ],
}

function mockCatalogFiles() {
  vi.mocked(readCatalogFile).mockImplementation((fileName: string) => {
    if (fileName === 'general-modules.json') return modules
    if (fileName === 'customer-link-registry.json') return linkRegistry
    return null
  })
}

beforeEach(() => {
  vi.mocked(readCatalogFile).mockReset()
  __resetKnowledgeCacheForTests()
  mockCatalogFiles()
})

describe('resolveKnowledgeForTopic', () => {
  it('resolves approved, customer-visible modules for a topic into facts + link', () => {
    const result = resolveKnowledgeForTopic('inclusions', 'what is included?')

    expect(result.factualLines).toEqual(['Every package includes private transport, driver/guide, entrance fees, and water.'])
    expect(result.detailLines).toEqual(['Full detail about inclusions.'])
    expect(result.primaryLink).toBe('https://javavolcano-touroperator.com/policy/inclusions-exclusions')
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
    expect(result.primaryLink).toBeNull()
  })

  it('never guesses a link for an ambiguous link_key', () => {
    const withAmbiguousLink = [{ ...modules[0], link_key: 'ambiguous_key' }]
    vi.mocked(readCatalogFile).mockImplementation((fileName: string) => {
      if (fileName === 'general-modules.json') return withAmbiguousLink
      if (fileName === 'customer-link-registry.json') return linkRegistry
      return null
    })
    const result = resolveKnowledgeForTopic('inclusions', 'what is included?')
    expect(result.primaryLink).toBeNull()
  })

  it('never surfaces a link whose registry status is not "existing"', () => {
    const withUnverifiedLink = [{ ...modules[0], link_key: 'not_yet_live' }]
    vi.mocked(readCatalogFile).mockImplementation((fileName: string) => {
      if (fileName === 'general-modules.json') return withUnverifiedLink
      if (fileName === 'customer-link-registry.json') return linkRegistry
      return null
    })
    const result = resolveKnowledgeForTopic('inclusions', 'what is included?')
    expect(result.primaryLink).toBeNull()
  })

  it('adds the availability disclosure for the price topic', () => {
    const result = resolveKnowledgeForTopic('price', 'how much?')
    expect(result.disclosures).toEqual([
      'Nearly always available -- exact availability for a specific date is confirmed automatically at checkout, so encourage the customer to go ahead and book rather than asking for their dates first "to verify".',
    ])
  })

  it('resolves the matching destination module + link for destination_readiness when a destination is passed', () => {
    const result = resolveKnowledgeForTopic('destination_readiness', 'is ijen safe?', 'ijen')
    expect(result.factualLines).toContain('Ijen crater is an active volcano site.')
    expect(result.primaryLink).toBe('https://javavolcano-touroperator.com/destinations/ijen-crater')
  })

  it('resolves a different destination module for a different destination, same topic', () => {
    const result = resolveKnowledgeForTopic('destination_readiness', 'is bromo safe?', 'bromo')
    expect(result.factualLines).toContain('Bromo is famous for its sunrise viewpoint.')
    expect(result.primaryLink).toBe('https://javavolcano-touroperator.com/destinations/mount-bromo')
  })

  it('stays empty for destination_readiness when no destination is passed (unknown/ambiguous)', () => {
    const result = resolveKnowledgeForTopic('destination_readiness', 'is it safe?')
    expect(result.factualLines).toEqual([])
    expect(result.primaryLink).toBeNull()
  })

  it('does not pull in a destination module for topics other than destination_readiness', () => {
    const result = resolveKnowledgeForTopic('price', 'how much?', 'ijen')
    expect(result.factualLines).not.toContain('Ijen crater is an active volcano site.')
  })

  it('pulls in destination-conditional inclusion variations (gas mask) for the inclusions topic when destination matches', () => {
    const result = resolveKnowledgeForTopic('inclusions', 'is gas mask included?', 'ijen')
    expect(result.factualLines).toContain('Gas masks and trekking poles for the Ijen crater hike.')
  })

  it('pulls in a different destination-conditional inclusion (private jeep) for a different destination', () => {
    const result = resolveKnowledgeForTopic('inclusions', 'what is included?', 'bromo')
    expect(result.factualLines).toContain('Private 4WD jeep for the Bromo Sea of Sand and sunrise viewpoint.')
    expect(result.factualLines).not.toContain('Gas masks and trekking poles for the Ijen crater hike.')
  })

  it('does not pull in a destination-conditional inclusion when no destination is passed', () => {
    const result = resolveKnowledgeForTopic('inclusions', 'what is included?')
    expect(result.factualLines).not.toContain('Gas masks and trekking poles for the Ijen crater hike.')
  })

  // Reported 2026-08-05: policy_isic_student, policy_police_escort, and
  // inclusion_east_java_bali_ferry were approved, customer_visible content that NOTHING ever
  // surfaced -- not TOPIC_MODULES, not the destination-variation lookup (their triggers are
  // "student"/"escort"/"ferry", none of which is a real destination token). Reachable ONLY
  // through the customer's own words, regardless of topic.
  describe('keyword-triggered conditional-eligibility modules', () => {
    it('surfaces ISIC student pricing when the message mentions it, on an unrelated topic', () => {
      const result = resolveKnowledgeForTopic('price', 'do you have student pricing with ISIC?')
      expect(result.factualLines).toContain('Student pricing is available to verified ISIC cardholders.')
    })

    // Reported live 2026-08-05: the fact surfaced correctly, but the link was a generic
    // inclusions page instead of the ISIC-specific one -- the primaryLink loop found whichever
    // TOPIC_MODULES-based module happened to resolve a link first, since keyword-triggered
    // modules are appended to moduleIds last. A keyword-triggered module's own link now wins.
    it("prefers the keyword-triggered module's OWN link over a topic-general module's link", () => {
      const result = resolveKnowledgeForTopic('price', 'do you have student pricing with ISIC?')
      expect(result.primaryLink).toBe('https://javavolcano-touroperator.com/isic/student-package')
    })

    it('surfaces the police escort policy when a large group asks about it', () => {
      const result = resolveKnowledgeForTopic('general', 'can you arrange a police escort for our group?')
      expect(result.factualLines).toContain('For large groups, JVTO can coordinate an official police escort.')
    })

    it('surfaces the Bali ferry crossing fact when the message mentions ferry/Ketapang/Gilimanuk', () => {
      expect(resolveKnowledgeForTopic('general', 'is the ferry included?').factualLines).toContain(
        'Ketapang-Gilimanuk ferry crossing for Bali-linked packages.'
      )
      expect(resolveKnowledgeForTopic('general', 'how does the Ketapang crossing work?').factualLines).toContain(
        'Ketapang-Gilimanuk ferry crossing for Bali-linked packages.'
      )
    })

    it('does not surface any of these when the message never mentions them', () => {
      const result = resolveKnowledgeForTopic('price', 'how much for 4 people?')
      expect(result.factualLines).not.toContain('Student pricing is available to verified ISIC cardholders.')
      expect(result.factualLines).not.toContain('For large groups, JVTO can coordinate an official police escort.')
      expect(result.factualLines).not.toContain('Ketapang-Gilimanuk ferry crossing for Bali-linked packages.')
    })
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

  it('caches loaded modules/links across calls until reset (module-level lazy cache)', () => {
    resolveKnowledgeForTopic('inclusions', 'what is included?')
    resolveKnowledgeForTopic('inclusions', 'what is included?')
    // Each of loadModules/loadLinkIndex reads its own file once, not once per call.
    const generalModulesCalls = vi.mocked(readCatalogFile).mock.calls.filter(([f]) => f === 'general-modules.json')
    expect(generalModulesCalls).toHaveLength(1)
  })
})

describe('resolveRouteLegFacts', () => {
  // Reported 2026-08-06: general-modules.json's route_leg_* modules carry real,
  // operator-sourced travel-time estimates but had no short_answer/customer_visible at all --
  // a customer asking "how many hours from Surabaya to Bromo?" got nothing.
  it('resolves the real fact when the message names two places AND asks a travel-time question', () => {
    const facts = resolveRouteLegFacts('How many hours from Surabaya to Bromo?')
    expect(facts).toEqual(['Surabaya Airport to Bromo Area: ±3.5-4.5 hours (operational).'])
  })

  it('works in Indonesian ("berapa jam") and regardless of place-name order', () => {
    expect(resolveRouteLegFacts('Dari Bromo ke Surabaya berapa jam?')).toEqual([
      'Surabaya Airport to Bromo Area: ±3.5-4.5 hours (operational).',
    ])
  })

  it('resolves multiple legs when a message asks about several at once', () => {
    const facts = resolveRouteLegFacts(
      'Day 1 pickup at Surabaya to Bromo, how many hours? Day 2 Bromo to Madakaripura, how many hours?'
    )
    expect(facts).toEqual([
      'Surabaya Airport to Bromo Area: ±3.5-4.5 hours (operational).',
      'Bromo Area to Madakaripura Waterfall: ±45-60 min drive (+20-30 min canyon walk).',
    ])
  })

  it('returns nothing when the message does not look like a travel-time question at all', () => {
    expect(resolveRouteLegFacts('We are interested in Surabaya to Bromo package, how much?')).toEqual([])
  })

  it('returns nothing when only one place (or no known pair) is mentioned', () => {
    expect(resolveRouteLegFacts('How many hours to Bromo?')).toEqual([])
    expect(resolveRouteLegFacts('How many hours from Malang to Papuma?')).toEqual([])
  })
})

describe('GENERAL_FAQ_FALLBACK', () => {
  // Reported 2026-08-05: the bot handed off "genuinely unsupported" topics that this exact
  // content already answers -- deposit percentage, Ijen gas mask/health screening inclusion,
  // packing list, physical difficulty per destination.
  it('covers the specific facts reported as missing (deposit percentage, gas mask inclusion)', () => {
    expect(GENERAL_FAQ_FALLBACK).toContain('Deposit: 20%')
    expect(GENERAL_FAQ_FALLBACK.toLowerCase()).toContain('gas mask')
  })

  // Operator-confirmed 2026-08-06: Revolut is fine too, it's essentially just a bank transfer.
  it('mentions Revolut alongside Wise as an accepted transfer method', () => {
    expect(GENERAL_FAQ_FALLBACK).toContain('Revolut')
  })

  it('is always non-empty (a static constant, not data that can fail to load)', () => {
    expect(GENERAL_FAQ_FALLBACK.length).toBeGreaterThan(500)
  })
})

describe('GUARDRAIL_INSTRUCTION', () => {
  // Reported live 2026-08-05: "For 3 people, the price is Rp3.275.000/person... Please let us
  // know your travel dates so we can verify the schedule for you" -- confirmed with the
  // operator, tours are nearly always available and the real check happens automatically at
  // checkout, so asking the customer for their dates first is unnecessary friction, not honest
  // caution. The old guardrail wording ("NEVER confirm exact availability without noting it
  // needs live verification") was what pushed the LLM toward that "please verify" phrasing.
  it('tells the LLM to encourage booking directly instead of asking for dates "to verify"', () => {
    expect(GUARDRAIL_INSTRUCTION).toContain('nearly always available')
    expect(GUARDRAIL_INSTRUCTION).toContain('NEVER ask "please let us know your travel dates so we can verify"')
  })
})

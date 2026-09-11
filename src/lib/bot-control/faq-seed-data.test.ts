import { describe, it, expect } from 'vitest'
import { FAQ_SEED_DATA } from './faq-seed-data'
import { validateKnowledgeBody } from './knowledge-body'
import { RESOLVER_TOPICS } from '@/lib/bot/module-resolver'

describe('FAQ_SEED_DATA', () => {
  it('has exactly 11 entries, one per GENERAL_FAQ_FALLBACK block', () => {
    expect(FAQ_SEED_DATA).toHaveLength(11)
  })

  it('has the 11 expected titles, in block order', () => {
    expect(FAQ_SEED_DATA.map((e) => e.title)).toEqual([
      'GENERAL',
      'BLUE FIRE',
      'MEDICAL SCREENING',
      'INCLUSIONS',
      'EXCLUSIONS',
      'PAYMENT',
      'WHAT TO BRING',
      'BEST TIME',
      'PHYSICAL DIFFICULTY',
      'DESTINATIONS',
      'FERRY / TRANSPORT',
    ])
  })

  it.each(FAQ_SEED_DATA.map((entry) => [entry.title, entry] as const))(
    '%s validates as a single-item knowledge body',
    (_title, entry) => {
      const result = validateKnowledgeBody({ items: [{ question: entry.question, answer: entry.answer, topics: entry.topics }] })
      expect(result.ok).toBe(true)
    }
  )

  it('every topic on every entry is a real ResolverTopic', () => {
    for (const entry of FAQ_SEED_DATA) {
      for (const topic of entry.topics) {
        expect(RESOLVER_TOPICS).toContain(topic)
      }
    }
  })

  it('every entry has at least one topic', () => {
    for (const entry of FAQ_SEED_DATA) {
      expect(entry.topics.length).toBeGreaterThan(0)
    }
  })

  it('GENERAL carries all 14 RESOLVER_TOPICS', () => {
    const general = FAQ_SEED_DATA.find((e) => e.title === 'GENERAL')
    expect(general).toBeDefined()
    expect([...general!.topics].sort()).toEqual([...RESOLVER_TOPICS].sort())
  })

  // Fix round 1 (R99), Minor 4: pins the plan's Step 3 table for EVERY block, not just GENERAL --
  // the pre-fix suite only pinned GENERAL's topics, so a slip on any of the other 10 (e.g.
  // MEDICAL SCREENING accidentally seeded as `inclusions` instead of `destination_readiness`)
  // would validate fine (a real ResolverTopic, at least one topic) and pass every other test in
  // this file without ever being caught. Table copied from the plan's Task 11 Step 3 (also
  // mechanically checked by `.superpowers/sdd/2026-09-10-alur-grounding/verify_seed_verbatim.ts`
  // against the same table, independently of this suite).
  const EXPECTED_TOPICS: Record<string, readonly string[]> = {
    GENERAL: RESOLVER_TOPICS,
    'BLUE FIRE': ['blue_fire'],
    'MEDICAL SCREENING': ['destination_readiness'],
    INCLUSIONS: ['inclusions'],
    EXCLUSIONS: ['inclusions'],
    PAYMENT: ['payment'],
    'WHAT TO BRING': ['destination_readiness'],
    'BEST TIME': ['blue_fire', 'destination_readiness'],
    'PHYSICAL DIFFICULTY': ['destination_readiness'],
    DESTINATIONS: ['general'],
    'FERRY / TRANSPORT': ['route_endpoint'],
  }

  it.each(Object.entries(EXPECTED_TOPICS))('%s has exactly the topics the Step 3 table names', (title, expectedTopics) => {
    const entry = FAQ_SEED_DATA.find((e) => e.title === title)
    expect(entry).toBeDefined()
    expect([...entry!.topics].sort()).toEqual([...expectedTopics].sort())
  })

  it('every answer is made only of "- " bullet lines (verbatim block content, no header/prose)', () => {
    for (const entry of FAQ_SEED_DATA) {
      for (const line of entry.answer.split('\n')) {
        expect(line.startsWith('- ')).toBe(true)
      }
    }
  })
})

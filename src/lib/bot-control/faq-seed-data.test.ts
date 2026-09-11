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

  it('every answer is made only of "- " bullet lines (verbatim block content, no header/prose)', () => {
    for (const entry of FAQ_SEED_DATA) {
      for (const line of entry.answer.split('\n')) {
        expect(line.startsWith('- ')).toBe(true)
      }
    }
  })
})

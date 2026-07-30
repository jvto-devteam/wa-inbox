import { describe, it, expect } from 'vitest'
import { classifyTopic, toComposableTopic } from './module-resolver'

describe('classifyTopic', () => {
  // Real test_topic_classification (jvto-whatsapp-agent-runtime/tests/test_resolvers.py) --
  // the exact 8 query/topic pairs the real system itself asserts, ported verbatim.
  it.each([
    ['How much for 4 people?', 'price'],
    ['What is included?', 'inclusions'],
    ['Is it private?', 'private_tour'],
    ['What vehicle will we use?', 'vehicle'],
    ['Can we finish in Bali?', 'route_endpoint'],
    ['What do we need for Ijen?', 'destination_readiness'],
    ['How do I book?', 'booking'],
    ['Is blue fire guaranteed?', 'blue_fire'],
  ] as const)('classifies %j as %j', (query, expected) => {
    expect(classifyTopic(null, query)).toBe(expected)
  })

  it('is case-insensitive', () => {
    expect(classifyTopic(null, 'HOW MUCH DOES IT COST?')).toBe('price')
  })

  it('scans keyword groups in priority order -- price wins over a later group in the same message', () => {
    // "price" is checked before "booking" in the real _TOPIC_KEYWORDS order.
    expect(classifyTopic(null, 'How much to book this tour?')).toBe('price')
  })

  it('falls back to the job default topic when no keyword matches', () => {
    expect(classifyTopic('J2', 'xyz')).toBe('price')
    expect(classifyTopic('J3', 'xyz')).toBe('route_endpoint')
    expect(classifyTopic('J4', 'xyz')).toBe('booking')
  })

  it('falls back to general with no job and no keyword match', () => {
    expect(classifyTopic(null, 'xyz')).toBe('general')
    expect(classifyTopic(undefined, '')).toBe('general')
  })
})

describe('toComposableTopic', () => {
  it('maps the topics wa-inbox catalog data can actually answer', () => {
    expect(toComposableTopic('price')).toBe('price')
    expect(toComposableTopic('booking')).toBe('how_to_book')
    expect(toComposableTopic('inclusions')).toBe('inclusions')
    expect(toComposableTopic('general')).toBe('inclusions')
    expect(toComposableTopic('destination_readiness')).toBe('policy')
    expect(toComposableTopic('blue_fire')).toBe('policy')
  })

  it('returns null (hand off) for every topic wa-inbox has no catalog data for', () => {
    for (const topic of ['private_tour', 'vehicle', 'rooming', 'hotel', 'route_endpoint', 'payment', 'cancellation', 'greeting'] as const) {
      expect(toComposableTopic(topic)).toBeNull()
    }
  })
})

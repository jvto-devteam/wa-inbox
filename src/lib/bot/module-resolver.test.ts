import { describe, it, expect } from 'vitest'
import { classifyTopic } from './module-resolver'

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

  // Regression, reported 2026-08-04: "how much is the deposit and when do I pay?" was
  // classifying as 'price' (whose keyword list includes the broad "how much"), whose module
  // set has no payment/deposit content -- so the bot said it didn't have deposit details for
  // a question policy_payment_deposit could actually answer. 'payment' is now checked first.
  it('classifies a compound price+payment question as payment, not price', () => {
    expect(classifyTopic(null, 'How much is the deposit and when do I pay?')).toBe('payment')
    expect(classifyTopic(null, 'Can I pay by bank transfer or installment?')).toBe('payment')
  })

  it('still classifies a pure price question as price when no payment keyword is present', () => {
    expect(classifyTopic(null, 'How much for 4 people?')).toBe('price')
    expect(classifyTopic(null, 'What is the cost per person?')).toBe('price')
  })

  // Regression, reported 2026-08-05: "...after transfer to Bali... are there guaranteed
  // private double rooms?" classified as 'payment' (bare "transfer" matched the travel sense,
  // not a money transfer), silently losing the real 'rooming' topic and its actual facts.
  // "airport transfer"/"private transfer"/"transfer to <city>" are common tour-operator
  // phrasing, so 'payment' now requires money-specific transfer wording.
  it('does NOT classify a travel/logistics "transfer" as payment', () => {
    expect(classifyTopic(null, 'After the tour we transfer to Bali, are the rooms private?')).not.toBe('payment')
    expect(classifyTopic(null, 'Is there an airport transfer included?')).not.toBe('payment')
    expect(classifyTopic(null, 'Can you arrange a private transfer from the hotel?')).not.toBe('payment')
  })

  it('still classifies a genuine money-transfer payment question as payment', () => {
    expect(classifyTopic(null, 'Can I pay by bank transfer?')).toBe('payment')
    expect(classifyTopic(null, 'Is there a wire transfer fee?')).toBe('payment')
    expect(classifyTopic(null, 'How do I transfer the deposit payment?')).toBe('payment')
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

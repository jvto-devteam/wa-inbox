/**
 * Integration check against the REAL synced release in `catalog/` -- mirrors
 * catalog.real.test.ts's rationale: knowledge.test.ts pins resolveKnowledgeForTopic's
 * behaviour with fixtures, this file answers "does the data actually on disk still
 * resolve real facts for the topics that used to hand off?" (private_tour, rooming,
 * hotel, payment -- verified live against the real WABA sandbox on 2026-08-04).
 *
 * Skips itself when the release is not present (gitignored, synced by
 * `npm run sync:knowledge`), same as catalog.real.test.ts.
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { resolveKnowledgeForTopic } from './knowledge'

const RELEASE_PRESENT = fs.existsSync(path.join(process.cwd(), 'catalog', 'general-modules.json'))

describe.skipIf(!RELEASE_PRESENT)('resolveKnowledgeForTopic against the real synced catalog/', () => {
  // These four previously handed off under the old 4-topic-only composer (verified live in
  // the sandbox conversation) -- the whole point of this file is a regression guard.
  it.each(['private_tour', 'rooming', 'hotel', 'payment'] as const)(
    'resolves at least one real fact for "%s", which used to have none at all',
    (topic) => {
      const result = resolveKnowledgeForTopic(topic, 'is ijen safe?')
      expect(result.factualLines.length).toBeGreaterThan(0)
    }
  )

  it('resolves a real, live URL (not null) for the price topic', () => {
    const result = resolveKnowledgeForTopic('price', 'how much?')
    expect(result.primaryLink).toMatch(/^https:\/\/javavolcano-touroperator\.com\//)
  })

  // Regression: reported 2026-08-04 -- "is ijen safe?" was linking to the generic package tour
  // page instead of anything Ijen-specific, because destination_readiness's own TOPIC_MODULES is
  // empty (matching chatbot-web, which never has destination context). orchestrator.ts DOES have
  // a matched destination by this point, so passing it through should resolve the real Ijen
  // destination guide, not a generic fallback.
  it('resolves the real Ijen destination guide link for destination_readiness when destination="ijen"', () => {
    const result = resolveKnowledgeForTopic('destination_readiness', 'is ijen safe?', 'ijen')
    expect(result.factualLines.length).toBeGreaterThan(0)
    expect(result.primaryLink).toBe('https://javavolcano-touroperator.com/destinations/ijen-crater')
  })

  it('returns no facts for a topic the real release genuinely has no modules for (route_endpoint)', () => {
    const result = resolveKnowledgeForTopic('route_endpoint', 'can we finish in bali?')
    expect(result.factualLines).toEqual([])
  })

  // Reported 2026-08-05: "what is your refund policy?" linked to a generic package tour page
  // instead of the real cancellation policy page. Root cause: general-modules.json's
  // policy_cancellation_package_credit module had link_key "cancellation_package_credit", but
  // customer-link-registry.json's actual entry for this content is keyed
  // "cancellation_travel_credit" -- a naming-drift bug shared with chatbot-web's own copy of
  // the same file, fixed at the source in all three synced repos.
  it('resolves the real cancellation/refund policy link for the cancellation topic, not a generic fallback', () => {
    const result = resolveKnowledgeForTopic('cancellation', 'what is your refund policy?')
    expect(result.factualLines.length).toBeGreaterThan(0)
    expect(result.primaryLink).toBe('https://javavolcano-touroperator.com/policy/booking-payment-cancellation')
  })

  // Reported 2026-08-05: real, approved, customer_visible ISIC/police-escort/ferry content
  // that no topic or destination lookup could ever reach -- only the customer's own words can.
  it.each([
    ['do you offer student discounts with ISIC?', 'isic'],
    ['can you arrange a police escort for our large group?', 'escort'],
    ['is the ferry crossing included?', 'ferry'],
  ] as const)('resolves a real fact when the message mentions %s (%s)', (message, _keyword) => {
    const result = resolveKnowledgeForTopic('general', message)
    expect(result.factualLines.length).toBeGreaterThan(0)
  })

  it("resolves the real ISIC-specific link (not a generic fallback) for a student-pricing question", () => {
    const result = resolveKnowledgeForTopic('price', 'do you offer student discounts with ISIC?')
    expect(result.primaryLink).toBe('https://javavolcano-touroperator.com/isic/student-package')
  })
})

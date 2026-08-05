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

  // Reported 2026-08-05: a group of 15 got "let me check with our team" for vehicle -- honest,
  // but incomplete, since the real answer (multiple Hiace, scaled to group size) exists once
  // told to us. service_vehicle_by_pax's `rules` array was never actually read by knowledge.ts
  // (only `short_answer`/`detail_summary` feed factualLines/detailLines), so the fix is in the
  // text itself, not new code.
  it('mentions multiple-Hiace scaling for large groups in the vehicle topic', () => {
    const result = resolveKnowledgeForTopic('vehicle', 'what vehicle for a group of 15?')
    expect(result.factualLines.some((f) => f.toLowerCase().includes('multiple hiace'))).toBe(true)
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

  // Reported 2026-08-05: a dietary-accommodation request ("please make sure her meals don't
  // contain beef") had no real module to answer from at all -- no topic keyword bucket, no
  // catalog content. Confirmed with the operator: this is a per-customer preference to note
  // for their trip, not a specific accommodation to promise, hence "noted" rather than a
  // fabricated capability claim. Reached via KEYWORD_TRIGGERED_MODULES (fires regardless of
  // topic), so checked against 'general' -- the topic a dietary mention actually classifies as.
  it.each([
    ["please make sure her meals don't contain any beef-related ingredients", 'beef'],
    ['do you have halal options?', 'halal'],
    ['I am vegetarian, is that possible?', 'vegetarian'],
  ] as const)('notes a dietary preference/restriction for %s (%s)', (message, _keyword) => {
    const result = resolveKnowledgeForTopic('general', message)
    expect(result.factualLines.some((f) => f.toLowerCase().includes('noted'))).toBe(true)
  })

  // Reported 2026-08-05: confirmed with the operator -- rooms are always private to the
  // customer's own group (never shared with strangers), and upgrades are a real, offerable
  // option, not just an internal ops flag (`requires_quote_check_when: ["room_upgrade"]`
  // existed already, but the customer-facing short_answer never said so).
  it('mentions rooms are private and that upgrades are available in the rooming topic', () => {
    const result = resolveKnowledgeForTopic('rooming', 'are the rooms private, and can we upgrade?')
    expect(result.factualLines.some((f) => f.toLowerCase().includes('private'))).toBe(true)
    expect(result.factualLines.some((f) => f.toLowerCase().includes('upgrade'))).toBe(true)
  })

  // Reported live 2026-08-05: "will you send an official booking confirmation or invoice under
  // PT Java Volcano Rendezvous?" had no real module to answer from -- confirmed real, live
  // content exists (javavolcano-touroperator.com/policy/booking-payment-cancellation, cross-
  // checked against jvto-web's real source): JVTO (legally PT Java Volcano Rendezvous) issues
  // an Official E-Voucher/Invoice (PDF) after payment.
  it.each([
    ['will you send an official invoice after payment?', 'invoice'],
    ['can I get an e-voucher for my booking?', 'e-voucher'],
    ['is PT Java Volcano Rendezvous your legal company name?', 'PT Java Volcano'],
  ] as const)('resolves the real official-invoice fact for %s (%s)', (message, _keyword) => {
    const result = resolveKnowledgeForTopic('general', message)
    expect(result.factualLines.some((f) => f.toLowerCase().includes('e-voucher') || f.toLowerCase().includes('invoice'))).toBe(true)
  })

  // Reported live 2026-08-05: "do you have a replacement arrangement and an emergency contact
  // we can reach at any time?" had no real module either -- confirmed real, live content
  // exists (safety-on-tours + booking-payment-cancellation + contact pages): medical-emergency
  // handling, force-majeure alternative arrangements, and honest (not 24/7) support hours.
  // Vehicle/driver backup wording confirmed directly with the operator 2026-08-05 (every unit
  // is kept ready, backup always available) -- no longer hedged as an unpublished internal
  // field the way it was on first pass.
  it.each([
    ['what happens in a medical emergency during the tour?', 'emergency'],
    ['is there a backup vehicle if ours breaks down?', 'vehicle breakdown'],
    ['can I reach you 24/7?', '24/7'],
  ] as const)('resolves the real emergency/support fact for %s (%s), honestly stating support hours are not 24/7', (message, _keyword) => {
    const result = resolveKnowledgeForTopic('general', message)
    expect(result.factualLines.some((f) => f.includes('08:00-22:00 WIB'))).toBe(true)
  })

  it('confirms every unit is kept ready with a backup always available (operator-confirmed 2026-08-05)', () => {
    const result = resolveKnowledgeForTopic('general', 'is there a backup vehicle if ours breaks down?')
    expect(result.factualLines.some((f) => f.toLowerCase().includes('backup') && f.toLowerCase().includes('ready'))).toBe(true)
  })

  // Reported live 2026-08-05: the real customer message ("If the driver or vehicle breaks
  // down during the tour, is there a backup unit ready?") matched NEITHER of the original
  // literal keyword phrases ('vehicle breakdown', 'backup vehicle') -- "breaks down" and
  // "backup unit" are different word forms/phrasing that a real customer actually used.
  it('resolves the emergency/support fact for the exact real phrasing that was missed ("breaks down" / "backup unit", not "vehicle breakdown" / "backup vehicle")', () => {
    const result = resolveKnowledgeForTopic(
      'general',
      'If the driver or vehicle breaks down during the tour, is there a backup unit ready?'
    )
    expect(result.factualLines.some((f) => f.toLowerCase().includes('backup'))).toBe(true)
  })

  // Confirmed directly with the operator 2026-08-05: official access down into the Ijen
  // crater for close-up blue fire is currently closed, but the summit sunrise viewpoint, blue
  // crater-lake view, and surrounding mountain scenery are still open for hiking. A current,
  // time-sensitive operational status, distinct from the evergreen "can't guarantee weather"
  // disclaimer -- both must be present so the bot never implies crater access is open.
  it.each([
    ['is the blue fire still accessible?', 'blue fire'],
    ['can we see the blue-fire at Ijen?', 'blue-fire'],
    ['what is the current crater access status?', 'crater access'],
  ] as const)('resolves the real Ijen crater-access closure fact for %s (%s)', (message, _keyword) => {
    const result = resolveKnowledgeForTopic('blue_fire', message, 'ijen')
    expect(result.factualLines.some((f) => f.toLowerCase().includes('closed'))).toBe(true)
    expect(result.factualLines.some((f) => f.toLowerCase().includes('sunrise'))).toBe(true)
  })

  // Researched 2026-08-05 across jvto-web, jvto-itinerary-core, jvto-whatsapp-agent-runtime,
  // and chatbot-web: only ONE genuine drone fact exists anywhere, and it is general (not
  // per-destination) -- jvto-web's own "special-services" FAQ entry. No per-destination
  // permits/fees/altitude limits are published anywhere, so none are fabricated here either.
  it.each([
    ['can we bring a drone?', 'drone'],
    ['is a UAV allowed on the tour?', 'UAV'],
    ['can we take aerial photography during the hike?', 'aerial photography'],
  ] as const)('resolves the real drone-usage fact for %s (%s)', (message, _keyword) => {
    const result = resolveKnowledgeForTopic('general', message)
    expect(result.factualLines.some((f) => f.toLowerCase().includes('drone'))).toBe(true)
    expect(result.detailLines.some((d) => d.toLowerCase().includes('permitted'))).toBe(true)
  })
})

/**
 * Response composer -- TypeScript port of jvto-agent-runtime's `response_composer.py`
 * (see .../src/jvto_agent_runtime/response_composer.py), scoped to the one part of it
 * that survives wa-inbox's much simpler data model: topic-scoped body assembly from a
 * single already-resolved catalog package, with price gated to price-relevant topics
 * and never surfaced on a handoff.
 *
 * --- What the real Python does ---
 *
 * `compose_customer_response` (lines 134-251) is an orchestration function, not a pure
 * formatter: it calls `delivery_adapter.delivery_plan_from_decision` (route gate, link
 * resolution, the envelope's handoff/needs_information floor) AND
 * `customer_sales_executor.CustomerSalesExecutor` (catalog facts + a per-pax published
 * price looked up from a release directory), unifies their state (package not_found /
 * price custom_quote_required / price unavailable / route gap -> handoff; route
 * needs_review -> price still shown + a disclosure), and only then assembles the reply.
 * Task 20's `Catalog`/`CatalogPackage` has no release directory, no DecisionEnvelope, no
 * pax, no route-gate/link-resolver machinery, and no distinct custom_quote_required vs.
 * unavailable price states -- so this port narrows to the one piece that is faithfully
 * portable against wa-inbox's shape: `_topic_fact` (lines 48-131) + the body-assembly
 * block of `compose_customer_response` (lines 189-219), fed by an already-resolved
 * `CatalogPackage` and a single boolean `isHandoff` (the caller -- route-gate.ts's
 * `checkRouteGate` plus whatever upstream envelope logic wa-inbox eventually has -- is
 * responsible for deciding that boolean; this function does not compute it).
 *
 * The rule this task exists to verify (docstring line 24, and re-derived independently
 * from the code): "A concrete price is shown ONLY when message_mode != handoff and
 * price.status=priced." Concretely in the real source:
 *   - `PRICE_RELEVANT_TOPICS = {"price", "booking"}` (line 45) -- price may be shown
 *     for these two topics ONLY. Every other topic answers its own scoped fact and
 *     NEVER carries a price line (line 44 comment: "price only for price-relevant
 *     inquiries").
 *   - `price_surfaced = price_relevant and (message_mode != "handoff") and
 *     not needs_information and pricing["status"] == "priced"` (line 180).
 *   - the topic-scoped fact line itself is suppressed entirely on handoff too
 *     (line 202: `if topic_line and not needs_handoff`) -- a handoff response answers
 *     with the fallback line only, never a partial fact.
 *
 * --- Mapping to wa-inbox's simpler shapes (judgment calls) ---
 *
 * The brief's fixed topic union is `'inclusions' | 'how_to_book' | 'policy' | 'price'`.
 * The real system's topic set (module_resolver.py:26-30) is much larger (route_endpoint,
 * destination_readiness, booking, payment, cancellation, blue_fire, vehicle, rooming,
 * hotel, private_tour, ...), almost all keyed off catalog facts (vehicle category,
 * rooming, staging notes, endpoint options) that `CatalogPackage` has no field for at
 * all (Task 20 confirmed this; same "nothing to port against" situation Task 22 hit for
 * `effective_instant_book_eligible`). The four topics kept here line up 1:1 with the
 * four fields `CatalogPackage` actually carries (`inclusions`, `policyNotes`,
 * `links.booking`, `priceIdr`), so they're implemented; the rest are out of scope for
 * this port, not silently dropped.
 *
 *   1. `topic: 'inclusions'` -> real `topic == "inclusions"` (line 127-129), including
 *      its `inc[:4]` cap ("never dumps an unbounded list"). Confidence: high, direct
 *      port.
 *
 *   2. `topic: 'price'` -> real `topic == "price"`, which is in `PRICE_RELEVANT_TOPICS`.
 *      Confidence: high, direct port of the core rule under test.
 *
 *   3. `topic: 'how_to_book'` -> real `topic == "booking"`. CONFIRMED, not assumed: line
 *      45's `PRICE_RELEVANT_TOPICS = {"price", "booking"}` explicitly includes
 *      "booking"; module_resolver.py:63 maps the phrase "how do i book" to topic
 *      "booking"; presentation_resolver.py:41 gives "booking" its own "booking_start"
 *      presentation mode. So a booking question in the real system DOES surface price
 *      when not a handoff -- exactly like the price topic. **This corrects a real bug
 *      in the task brief's placeholder MVP**, which never showed price for
 *      `how_to_book` under any circumstance (same category of gap as Task 23's dropped
 *      fail-safe handoff signal: the brief's rough draft silently under-delivered a
 *      real, source-verified behavior). Confidence: high -- verified directly against
 *      the constant on line 45, not inferred.
 *      The booking LINK line, by contrast, is deliberately gated on `!isHandoff` here
 *      even though the real source's own "Details: {url}" line (212-214) has no
 *      explicit handoff check of its own -- because in the real system that omission is
 *      safe only because the upstream delivery plan has ALREADY stripped the link
 *      before a handoff case reaches the composer (presentation_resolver.py:12,
 *      explicit design rule: "Never gives a direct booking CTA on a custom-quote
 *      case."). This port has no upstream delivery-plan step to rely on, so it enforces
 *      the same no-CTA-on-handoff invariant directly. Confidence: high -- this is
 *      preserving a stated safety invariant, not inventing one.
 *
 *   4. `topic: 'policy'` has NO direct analog in the real topic set at all -- the real
 *      system splits this across "payment" and "cancellation" topics (module_resolver.py
 *      TOPIC_GENERAL_MODULES lines 42-44), neither of which is in
 *      PRICE_RELEVANT_TOPICS, and neither of which has a `_topic_fact` case (their body
 *      content comes from generic policy modules' short_answers -- data wa-inbox has no
 *      equivalent of). `CatalogPackage.policyNotes` is the one catalog-native field that
 *      plays the same *role* ("something the customer must be told before we call this
 *      settled"), so this port reuses it directly for the 'policy' topic, mirroring
 *      route-gate.ts's precedent of reusing `policyNotes` as the best available proxy
 *      for a real signal with no 1:1 field. Confidence: medium (same caveat route-gate.ts
 *      documented: judgment, not a literal port) -- but the price-gating consequence is
 *      high confidence regardless: 'policy' is clearly not "price" or "booking", so it
 *      is never price-relevant under any reasonable topic mapping.
 *
 * `priceIdr: number | null` is wa-inbox's single collapsed state standing in for the
 * real system's two distinct non-priced states (`custom_quote_required` -- pax below
 * minimum / flagged; `unavailable` -- e.g. pax not yet known). `CatalogPackage` carries
 * no pax and no flags, so there is nothing to discriminate the two with; `priceIdr ===
 * null` triggers one generic "will be confirmed by our team" fallback line, covering
 * both real states with a single conservative message that never fabricates a number.
 * Confidence: medium (same reasoning as route-gate.ts's `priceIdr`-as-gap proxy).
 *
 * The real `AVAILABILITY_DISCLOSURE` ("availability -> always a live-confirmation
 * disclosure on a surfaced price", docstring line 23) and the route-`needs_review`
 * disclosure are both modeled in the real system as entries in a SEPARATE
 * `required_disclosures` array on the structured `CustomerResponseDraft`. The brief's
 * fixed signature returns a single `string`, not a structured draft, so there is no
 * separate disclosures channel to preserve here (the brief's placeholder already made
 * this simplification; this port keeps it). The availability disclosure is therefore
 * folded directly into the surfaced-price line's text instead of a separate line/field,
 * so its substance ("a price is never a guaranteed booked slot") survives even though
 * the structural separation does not. The `needs_review` route disclosure is genuinely
 * out of scope here: this function's interface (fixed by the brief/Task 20) takes only
 * a boolean `isHandoff`, not the three-way `clear | needs_review | handoff` that
 * route-gate.ts's `checkRouteGate` actually produces, so a caller wiring the two
 * modules together is responsible for surfacing that middle state; it cannot be added
 * inside `composeResponse` without changing its contracted input shape (out of scope
 * for this task).
 *
 * Unknown `packageKey` (real: `package.status=not_found` -> handoff, docstring line 18)
 * is ported as an ESCALATE-ONLY override: this function forces the handoff-fallback
 * response whenever the package can't be found, REGARDLESS of the caller's `isHandoff`
 * value -- mirroring `catalog_forces_handoff` (line 164), which is unconditional and
 * independent of whatever the delivery plan itself decided. Confidence: high, direct
 * port of a documented state-discipline rule.
 *
 * Finally: the real composer NEVER returns an empty draft -- even the pure-handoff /
 * unknown-package path still emits at least the title (if resolved) and/or the handoff
 * fallback line (line 215-216: "A team member will follow up to confirm the
 * details."). This port preserves that as a hard invariant (see the "never returns an
 * empty string" test) -- silently returning `""` on a handoff would mean the customer
 * gets no message at all instead of the required human-handoff notice, which is exactly
 * the class of dropped fail-safe signal Task 23's review flagged. The brief's
 * placeholder MVP violated this (`if (!pkg) return ''`, and the price case returning
 * `''` on handoff) and is corrected here.
 */
import type { Catalog } from './types'

// Real: PRICE_RELEVANT_TOPICS = {"price", "booking"} (response_composer.py:45).
// 'how_to_book' is this port's analog of the real "booking" topic (see file header).
const PRICE_RELEVANT_TOPICS = new Set(['price', 'how_to_book'])

const HANDOFF_FALLBACK_LINE = 'Tim kami akan segera membantu Anda untuk paket ini.'

export function composeResponse(input: {
  topic: 'inclusions' | 'how_to_book' | 'policy' | 'price'
  packageKey: string
  catalog: Catalog
  isHandoff: boolean
}): string {
  const { topic, packageKey, catalog } = input
  const pkg = catalog.packages.find((p) => p.packageKey === packageKey)

  // Real: catalog_forces_handoff = catalog["status"] == "not_found" (line 164) --
  // unconditional, independent of the caller's own handoff signal (escalate-only).
  const isHandoff = input.isHandoff || !pkg

  const lines: string[] = []

  if (pkg) {
    // Real: lines.append(catalog["title"]) when resolved (lines 193-194), regardless
    // of handoff -- the title is a settled fact, not a committal claim.
    lines.push(pkg.title)

    // Real: `if topic_line and not needs_handoff` (line 202-203) -- the topic-scoped
    // fact itself is suppressed entirely on handoff, not just the price.
    if (!isHandoff) {
      if (topic === 'inclusions' && pkg.inclusions.length > 0) {
        // Real: inc[:4] cap (line 129) -- never dumps an unbounded inclusion list.
        lines.push(`Termasuk: ${pkg.inclusions.slice(0, 4).join(', ')}.`)
      } else if (topic === 'policy' && pkg.policyNotes.length > 0) {
        lines.push(pkg.policyNotes.join(' '))
      }
    }

    const priceRelevant = PRICE_RELEVANT_TOPICS.has(topic)
    if (priceRelevant && !isHandoff) {
      if (pkg.priceIdr !== null) {
        // Real: the surfaced-price line (lines 204-209) + the folded-in availability
        // disclosure (docstring line 23; see file header on why it's inline here
        // rather than a separate disclosures entry).
        lines.push(
          `Rp${pkg.priceIdr.toLocaleString('id-ID')} per orang -- harga standar yang sudah dipublikasikan. ` +
            'Ketersediaan tetap perlu dikonfirmasi untuk tanggal Anda.'
        )
      } else {
        // Real: the custom_quote_required fallback line (line 210-211), generalized to
        // also cover the real system's separate `unavailable` state (see file header).
        lines.push('Untuk paket ini, harga akan dikonfirmasi langsung oleh tim kami.')
      }
    }

    // Real: "Details: {url}" (lines 212-214), scoped here to the how_to_book topic and
    // gated on !isHandoff -- see file header for why this port adds the handoff gate
    // explicitly instead of relying on an upstream delivery plan to have stripped it.
    if (topic === 'how_to_book' && !isHandoff && pkg.links.booking) {
      lines.push(`Link booking: ${pkg.links.booking}`)
    }
  }

  // Real: `if needs_handoff and not any("team member" in l.lower() for l in lines)`
  // (lines 215-216) -- the composer never returns an empty draft; a handoff always
  // gets at least this fallback line.
  if (isHandoff) {
    lines.push(HANDOFF_FALLBACK_LINE)
  }

  return lines.join('\n')
}

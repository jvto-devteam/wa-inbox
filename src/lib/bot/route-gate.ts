/**
 * Route-integrity gate — TypeScript port of jvto-agent-runtime's `route_gate.py`
 * + the route-gate branch of `presentation_resolver.py`'s `build_delivery_plan`
 * (see jvto-whatsapp-agent-runtime/src/jvto_agent_runtime/route_gate.py and
 * presentation_resolver.py:121-222, and docs/resolver-layer.md's
 * "Route-integrity gate + booking authority (P0)" table).
 *
 * --- What the real Python does ---
 *
 * `route_gate.py` loads two files vendored from jvto-itinerary-core
 * (`package-customization-boundaries.json`, `package-operational-composition.json`)
 * into a `RouteGate.by_key: dict[package_key, RouteGateEntry]`, where each entry
 * carries `integrity: "clean" | "needs_review" | "gap" | "unknown"` and
 * `effective_instant_book_eligible: bool`. Core is the *authoritative* owner of
 * route truth and booking eligibility ("Option A"): this overrides Bootstrap's
 * advisory `booking_mode.instant_book`. `RouteGate.get(package_key)` fails safe —
 * an unrecognized `package_key` synthesizes `integrity="unknown",
 * effective_instant_book_eligible=False` rather than returning nothing.
 *
 * `presentation_resolver.build_delivery_plan` (lines ~163-222) then applies:
 *   route_gap        = integrity in ("gap", "unknown")
 *   booking_blocked   = not effective_instant_book_eligible
 *   needs_review      = integrity == "needs_review"
 *   if route_gap or booking_blocked:
 *     -> mode="handoff", quote_eligibility="custom_quote_required",
 *        price facts dropped entirely, no booking CTA
 *   elif needs_review:
 *     -> standard price IS still shown, but a route-validation disclosure is
 *        added and requires_feasibility=true ("no route confirmed claim")
 *   else (clean):
 *     -> normal plan, no extra disclosure
 *
 * --- Mapping to wa-inbox's simpler Catalog shape (judgment calls) ---
 *
 * wa-inbox's `CatalogPackage` (Task 20) has no `route_integrity`,
 * `effective_instant_book_eligible`, or `flags` fields at all — it is a flat,
 * already-published sales catalog, not a mirror of jvto-itinerary-core's
 * agent-contract. There is therefore no 1:1 source of truth to port; the
 * decision below reconstructs the *spirit* of the three-way gate from the
 * fields wa-inbox's catalog actually has:
 *
 *   1. No destination extracted yet -> handoff.
 *      Not literally in route_gate.py (which fails safe from an unresolved
 *      *package_key*, not a missing destination) but the same fail-safe
 *      principle: without a destination there is no package to check
 *      route integrity against at all, so a human must take over. This case
 *      is also required verbatim by Task 20/the task brief's fixed contract.
 *
 *   2. Destination given, no package carries it among its `destinationTokens`
 *      (case-insensitive) -> handoff, reason cites the destination.
 *      Direct analog of `RouteGate.get()`'s fail-safe: an unrecognized key
 *      resolves to `integrity="unknown"` -> `route_gap=True` -> handoff.
 *      High confidence — this is the clearest and most direct port.
 *
 *      (Fix Wave 3b: this used to compare against a single
 *      `CatalogPackage.destination` string. The real synced release has no
 *      single-destination package -- all 16 are multi-destination overland
 *      tours -- so `CatalogPackage` now carries `destinationTokens: string[]`
 *      and a package matches when ANY of its tokens equals the destination.
 *      The comparison stays *exact* per token, not a substring test: the
 *      destination reaching this gate is the canonical token the funnel already
 *      matched and persisted into `tripBrief.destination`, so a looser
 *      comparison could only ever widen the gate, never help it. Fuzzy,
 *      customer-text-facing matching belongs in funnel.ts's `findMatch`, which
 *      is what produces that canonical token in the first place.)
 *
 *   3. Destination matches one or more packages, but NONE of them has a
 *      synced price (`priceIdr === null` for every match) -> handoff.
 *      Analog of `route_gap`/`gap`: the real gate drops price facts entirely
 *      on a gap, so a package we cannot price at all is functionally in the
 *      same "no facts to quote" state — there is nothing to hand a customer
 *      but a promise to check. Medium confidence: this is judgment, since the
 *      real system's `gap` is an *independent* signal from price presence.
 *      But wa-inbox's `Catalog` carries no other per-package signal that
 *      could stand in for "gap", and `priceIdr: number | null` is the one
 *      field Task 20 explicitly modeled as possibly-absent/unconfirmed, so
 *      it is the most defensible available proxy for "not yet route-clean."
 *
 *   4. A priced match exists, and at least one priced match carries
 *      `policyNotes` -> needs_review, reason names the destination.
 *      Analog of `integrity=="needs_review"`: standard price IS shown (we
 *      still return `clear`-adjacent pricing information upstream), but a
 *      disclosure is required and no "fully confirmed, no caveats" claim is
 *      made. `policyNotes` are wa-inbox's own catalog-native disclosures
 *      (e.g. "subject to weather", "requires 24h reconfirmation"), so using
 *      their presence to force `needs_review` is a low-risk, non-invented
 *      signal: it reuses data that already means "there is something the
 *      customer must be told" rather than fabricating a new field.
 *
 *      (Fix Wave 3b, on real data: `policyNotes` is now populated from the
 *      release's policy modules, but deliberately only the PACKAGE-SCOPED ones
 *      -- see catalog.ts's header. Had the 6 company-wide `global` policies
 *      been included too, every package would carry notes, `needs_review` would
 *      be constant-true, and this branch would stop discriminating anything. As
 *      populated, 13 of 16 packages (the Ijen ones) are `needs_review` for two
 *      real disclosures -- mandatory health screening and the monthly crater
 *      closure -- and the 3 non-Ijen packages are `clear`. Consumer side: the
 *      orchestrator does NOT hand off on `needs_review`; matching the real
 *      Python, the price is still shown and funnel.ts appends the disclosure to
 *      the reply. See orchestrator.ts step 6.)
 *
 *   5. A priced match exists with no policy notes -> clear.
 *
 * There is no wa-inbox equivalent of `effective_instant_book_eligible`
 * (booking-mode authority) at all — wa-inbox's `CatalogPackage` has no
 * booking-mode field of any kind (Bootstrap's `booking_mode.instant_book`
 * doesn't exist here either), so that half of the real gate has nothing to
 * port against and is intentionally omitted rather than guessed.
 */
import type { RouteGateResult, Catalog, CatalogPackage } from './types'

export function checkRouteGate(input: { destination?: string; catalog: Catalog }): RouteGateResult {
  const { destination, catalog } = input

  if (!destination) {
    return { status: 'handoff', reason: 'Tujuan belum diketahui dari percakapan' }
  }

  const wanted = destination.toLowerCase()
  const matches = catalog.packages.filter((p) =>
    p.destinationTokens.some((token) => token.toLowerCase() === wanted)
  )

  if (matches.length === 0) {
    return {
      status: 'handoff',
      reason: `Tidak ada paket terverifikasi untuk "${destination}"`,
    }
  }

  const priced = matches.filter((p): p is CatalogPackage & { priceIdr: number } => p.priceIdr !== null)

  if (priced.length === 0) {
    return {
      status: 'handoff',
      reason: `Belum ada harga tersinkron untuk paket ke "${destination}"`,
    }
  }

  const needsReview = priced.some((p) => p.policyNotes.length > 0)

  if (needsReview) {
    return {
      status: 'needs_review',
      reason: `Paket ke "${destination}" memiliki catatan kebijakan yang perlu dikonfirmasi sebelum dipastikan`,
    }
  }

  return { status: 'clear' }
}

/**
 * Funnel state machine -- TypeScript port of chatbot-web's `orderFlow.js`
 * (see /Users/macbook/Code/chatbot-web/src/orderFlow.js: state enum lines 6-14,
 * `processState`/`getReply` lines 52-163), driven by copy from `src/settings.js`'s
 * `DEFAULTS.templates` and reusing package-listing phrasing from `src/packages.js`'s
 * `buildPackageReply`.
 *
 * --- What the real JS does ---
 *
 * `orderFlow.js` is a *stateful, per-userId* funnel with exactly 4 states —
 * GREETING, TANYA_ORIGIN, REKOMENDASI, HUMAN_HANDOFF (confirmed by reading the file;
 * this is NOT the stale 10-state assumption from an earlier design pass) — plus a
 * persisted `orderData: { origin, endCity }` payload per user, mutated in place by
 * `processState`:
 *
 *   GREETING      -> always advances to TANYA_ORIGIN, but "greedily" detects both a
 *                    start and end city (Surabaya/Bali only, via regex `detectOriginAndEnd`)
 *                    in the very first message and short-circuits straight to
 *                    REKOMENDASI if both are already present ("Greedy: if user already
 *                    mentioned cities in first message, advance immediately").
 *   TANYA_ORIGIN  -> detects start/end city from the message; advances to REKOMENDASI
 *                    only once BOTH `origin` and `endCity` are known (may take more than
 *                    one message — first mention fills `origin`, a second fills `endCity`).
 *                    Otherwise stays, with a nudge that references whichever half is
 *                    still missing.
 *   REKOMENDASI   -> on entry, replies once with `buildPackageReply(filterPackages(origin,
 *                    endCity), origin, endCity)` (packages.js's numbered tour listing).
 *                    On every later message it explicitly STAYS — `getReply` returns
 *                    `null` for REKOMENDASI when `!stateChanged` ("LLM handles follow-ups")
 *                    and `chatbot.js` then routes to the LLM/FAQ layer instead of a static
 *                    reply. There is NO transition out of REKOMENDASI inside `processState`
 *                    at all.
 *   HUMAN_HANDOFF -> a sink state. Nothing in `processState`'s switch ever sets it —
 *                    it's only reached externally via `setHumanHandoff(userId)` (called
 *                    from `chatbot.js`'s own escalation-keyword check, a layer above
 *                    `orderFlow.js`) or `restoreSession`. Once in it, `case
 *                    "HUMAN_HANDOFF": break` — it never advances on its own.
 *
 * --- Mapping to wa-inbox's fixed signature + Catalog shape (disclosed judgment calls) ---
 *
 * Task 20 already fixed `Catalog`/`CatalogPackage` (flat `destination`/`title`/`priceIdr`
 * per package, no `origin`/`endCity`/route concept at all) and Task 27's own interface
 * fixes `processFunnelState` as a STATELESS per-call function of
 * `{ currentState, message, catalog } -> { reply, nextState }` — no persisted
 * `orderData` payload travels between calls the way `userStates[userId]` does in the
 * real source. Two consequences follow, both disclosed rather than silently invented:
 *
 *   1. Domain mismatch (city-routing vs destination catalog): orderFlow.js's
 *      actual question is "which of our 2 hub cities (Surabaya/Bali) do you start/end
 *      at", entirely orthogonal to wa-inbox's Catalog, which has no city/route field —
 *      only the destinations each package visits (e.g. "ijen"). The real TANYA_ORIGIN/
 *      REKOMENDASI copy is therefore NOT literally portable (porting it verbatim would
 *      ask customers a question the system cannot validate against). TANYA_ORIGIN's
 *      "which destination" matching below is a reasoned substitute for
 *      `detectOriginAndEnd` — same *role* (extract the one piece of info needed to
 *      unlock REKOMENDASI from free text), simplified to one field since Catalog only
 *      has one. Wherever the real copy is domain-agnostic (not city-specific), it is
 *      reused verbatim (see per-state notes below).
 *
 *      Fix Wave 3b: `CatalogPackage.destination: string` became
 *      `destinationTokens: string[]`, because every one of the 16 real synced
 *      packages is a multi-destination overland tour (see types.ts). `findMatch`
 *      below therefore scans the union of all packages' tokens and returns every
 *      package carrying the earliest-mentioned one — closer to `detectOriginAndEnd`
 *      than the single-string version was, since a real message ("bromo dan ijen")
 *      names several and the real source also disambiguates by string index.
 *      `processFunnelState` now also RETURNS the matched destination token: the
 *      orchestrator persists it into `tripBrief.destination`, which is what
 *      route-gate.ts validates. Previously the match was computed here, used for
 *      the reply, and thrown away — so `tripBrief.destination` was never written
 *      by anything and the route gate handed off on every single message.
 *   2. No persisted `orderData` means a `currentState === 'REKOMENDASI'` call has no
 *      memory of which destination was previously matched, and real `getReply` returns
 *      `null` for that case anyway (delegates to the LLM layer, which is Task 28/29 --
 *      out of this task's scope). Rather than inventing new copy for a case the real
 *      source deliberately leaves blank, REKOMENDASI-stays reuses the exact same
 *      generic clarification line the real source itself falls back to for any state
 *      with no specific nudge (see below) -- verbatim text, not fabricated. Critically,
 *      this state STAYS at REKOMENDASI, matching the real source; it does NOT
 *      auto-escalate to HUMAN_HANDOFF (the earlier placeholder draft of this task did
 *      that, and it does not match orderFlow.js -- there is no such transition anywhere
 *      in `processState`).
 *
 * --- Copy provenance (every reply below) ---
 *
 *   - HUMAN_HANDOFF reply: verbatim `orderFlow.js` `nudges.HUMAN_HANDOFF`. (The real
 *     source's OTHER, fuller HUMAN_HANDOFF template --
 *     `settings.js`'s `DEFAULTS.templates.HUMAN_HANDOFF` -- is sent only once, on
 *     first entry, via an external `setHumanHandoff()` call that this stateless
 *     function has no signal for; see the code comment on `HUMAN_HANDOFF_NUDGE`.)
 *   - Generic "didn't catch that" fallback (used for REKOMENDASI-stays and for any
 *     unrecognized `currentState`): verbatim `orderFlow.js` `getReply`'s
 *     `!stateChanged` fallback, `nudges[state] || "Sorry, I didn't quite catch
 *     that. Could you clarify? 😊"`.
 *   - GREETING/TANYA_ORIGIN "ask for destination" prompt: adapted (city -> destination,
 *     per judgment call #1 above), but reuses the real opening fragment "Where would
 *     you like to..." and the 🗺️ emoji from `getReply`'s TANYA_ORIGIN case, and lists
 *     the destinations dynamically from the *actual* passed-in catalog rather than
 *     inventing example destination names.
 *   - REKOMENDASI entry reply: adapted from `packages.js`'s `buildPackageReply` --
 *     the intro ("Here are our tours for *X*! 🌋"), numbered-list shape, and closing
 *     ("All tours are 100% private... feel free to ask me anything! 😊") are reused
 *     verbatim; the per-package line drops fields Catalog doesn't have (days/nights/
 *     priceTiers/highlights) since `CatalogPackage` only carries `title`/`priceIdr`/
 *     `links`.
 *   - "Good to know:" disclosure block (Fix Wave 3b): newly authored, with no
 *     counterpart in `packages.js` -- chatbot-web has no policy layer at all. It
 *     exists because the ported jvto-agent-runtime DOES: `presentation_resolver`'s
 *     `needs_review` branch keeps showing the standard price but attaches a
 *     disclosure (see route-gate.ts's header). route-gate.ts derives exactly that
 *     state from `policyNotes`, but after Wave 3a removed `composeResponse`'s only
 *     call site, nothing surfaced the disclosure anywhere -- the customer got the
 *     price with the caveat silently dropped. Attaching the notes here, to the
 *     reply that quotes the price, is the smallest faithful place to put them:
 *     the funnel already holds the matched packages, so no extra state has to be
 *     threaded from the route gate. The alternative (hand off on `needs_review`)
 *     would send 13 of the 16 real packages to a human for two disclosures that
 *     are published on the website anyway.
 */
import type { Catalog, CatalogPackage } from './types'

const GENERIC_CLARIFY = "Sorry, I didn't quite catch that. Could you clarify? 😊"

// Verbatim orderFlow.js `nudges.HUMAN_HANDOFF`. Note: the real source's OTHER
// HUMAN_HANDOFF reply -- settings.js's `DEFAULTS.templates.HUMAN_HANDOFF` (the fuller
// "connecting you with our team, here's our WhatsApp/email" message, sent once on
// first entry via `setHumanHandoff` + a synthetic `"__handoff__"` call) -- has no
// reachable call site in this port: like the real `processState`, nothing in this
// function's own switch ever transitions a *different* state into HUMAN_HANDOFF
// (it's only ever reached by the caller passing `currentState: 'HUMAN_HANDOFF'` in
// directly, which this stateless signature cannot distinguish from "already was
// there"). Producing that first-entry template is therefore the calling
// orchestrator's responsibility (Task 29, out of this task's scope), not this
// function's -- documented here rather than silently ported and left dead.
const HUMAN_HANDOFF_NUDGE = 'Our team will be with you shortly. Thank you for your patience! 😊'

// Cap on how many disclosure lines one recommendation reply may carry. The real
// release attaches at most 2 package-scoped policies to any package, so this is
// headroom against a future sync, not a filter on today's data -- an unbounded
// policy dump would push the actual tour list off a phone screen.
const MAX_DISCLOSURES = 4

// Every distinct destination token in the catalog, lowercased and deduped.
function allDestinationTokens(catalog: Catalog): string[] {
  return [...new Set(catalog.packages.flatMap((p) => p.destinationTokens.map((t) => t.toLowerCase())))]
}

// Tokens are canonical and lowercase ('tumpak sewu'); replies show them to a
// customer, so they get title-cased for display only -- never for matching.
function displayDestination(token: string): string {
  return token.replace(/\b\w/g, (c) => c.toUpperCase())
}

// Finds every package covering the single destination mentioned earliest in the
// message (mirrors orderFlow.js's `detectOriginAndEnd` disambiguating multiple city
// mentions by string index via `msg.search(...)`) -- avoids mixing packages from two
// different destinations under one recommendation reply if a message names more than
// one. A package matches on ANY of its `destinationTokens`, so a combined
// Bromo+Ijen tour is offered to a customer who asked about either.
function findMatch(message: string, catalog: Catalog): { destination: string; matches: CatalogPackage[] } | null {
  const lower = message.toLowerCase()
  let bestDestination: string | null = null
  let bestIndex = Infinity
  for (const token of allDestinationTokens(catalog)) {
    const index = lower.indexOf(token)
    if (index !== -1 && index < bestIndex) {
      bestIndex = index
      bestDestination = token
    }
  }
  if (bestDestination === null) return null
  const destination = bestDestination
  const matches = catalog.packages.filter((p) => p.destinationTokens.some((t) => t.toLowerCase() === destination))
  return matches.length > 0 ? { destination, matches } : null
}

function askForDestinationReply(catalog: Catalog): string {
  const destinations = allDestinationTokens(catalog).map(displayDestination)
  const list = destinations.length > 0 ? destinations.join(', ') : 'our tours'
  return `Where would you like to go? 🗺️\n\nWe currently offer tours to: ${list}. Just let me know which one interests you!`
}

function recommendationReply(destination: string, matches: CatalogPackage[]): string {
  const list = matches
    .map((p, i) => {
      const price = p.priceIdr != null ? `from Rp ${p.priceIdr.toLocaleString('id-ID')}/person` : 'price on request'
      const link = Object.values(p.links)[0]
      return `${i + 1}. ${p.title} — ${price}${link ? `\n   🔗 ${link}` : ''}`
    })
    .join('\n')

  // Package-scoped disclosures, deduped across the listed packages (they overlap
  // heavily -- every Ijen package carries the same two). This is the surfacing of
  // route-gate.ts's `needs_review` state; see the copy-provenance note in the header.
  const disclosures = [...new Set(matches.flatMap((p) => p.policyNotes))].slice(0, MAX_DISCLOSURES)
  const disclosureBlock =
    disclosures.length > 0 ? `\n\nGood to know:\n${disclosures.map((note) => `• ${note}`).join('\n')}` : ''

  return (
    `Here are our tours for *${displayDestination(destination)}*! 🌋\n\n${list}${disclosureBlock}\n\n` +
    'All tours are 100% private — just your group, no strangers!\n' +
    'Tap any link to view full details, or feel free to ask me anything! 😊'
  )
}

export function processFunnelState(input: {
  currentState: string
  message: string
  catalog: Catalog
}): { reply: string; nextState: string; destination?: string } {
  const { currentState, message, catalog } = input

  switch (currentState) {
    // Mirrors orderFlow.js's `case "GREETING"`: always advances to TANYA_ORIGIN, but
    // greedily short-circuits straight to REKOMENDASI if the needed info is already
    // in the first message.
    case 'GREETING':
    case 'TANYA_ORIGIN': {
      const match = findMatch(message, catalog)
      if (match) {
        // `destination` is the caller's only signal of what was matched -- the real
        // orderFlow.js kept it in its per-user `orderData`, which this stateless
        // signature has no equivalent for, so it travels out in the return value and
        // the orchestrator persists it into `tripBrief`.
        return {
          reply: recommendationReply(match.destination, match.matches),
          nextState: 'REKOMENDASI',
          destination: match.destination,
        }
      }
      return { reply: askForDestinationReply(catalog), nextState: 'TANYA_ORIGIN' }
    }

    // Mirrors orderFlow.js's `case "REKOMENDASI": break` — stays put; the real
    // source hands follow-ups to the LLM (getReply returns null), which is out of
    // this task's scope, so we reuse the source's own generic fallback line rather
    // than inventing new copy. Does NOT auto-escalate to HUMAN_HANDOFF.
    case 'REKOMENDASI':
      return { reply: GENERIC_CLARIFY, nextState: 'REKOMENDASI' }

    // Mirrors orderFlow.js's `case "HUMAN_HANDOFF": break` — a sink state that
    // never advances on its own within the funnel (escalation into it happens
    // externally, upstream of this function).
    case 'HUMAN_HANDOFF':
      return { reply: HUMAN_HANDOFF_NUDGE, nextState: 'HUMAN_HANDOFF' }

    // No case in orderFlow.js's own switch ever produces an unrecognized state
    // (only the 4 named states are ever assigned), so this mirrors the practical
    // effect of an unmatched/unchanged state hitting getReply's generic fallback.
    default:
      return { reply: GENERIC_CLARIFY, nextState: currentState }
  }
}

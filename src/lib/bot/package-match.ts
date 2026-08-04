/**
 * Resolves a customer message to a catalog destination + package -- a stateless,
 * one-shot replacement for the destination-matching half of the removed
 * chatbot-web-style funnel (formerly funnel.ts, a TypeScript port of a DIFFERENT
 * sibling repo's `orderFlow.js`, not the jvto-agent-runtime this bot is otherwise
 * built from). The matching algorithm itself is unchanged from that removed file:
 * the earliest-mentioned destination token wins (mirrors `orderFlow.js`'s own
 * `detectOriginAndEnd` disambiguation by string index), since that part was never
 * about running a multi-turn qualification dialogue -- it is simply "which package
 * is this message about," needed by any caller, stateful or not.
 */
import type { Catalog, CatalogPackage } from './types'

// Every distinct destination token in the catalog, lowercased and deduped.
function allDestinationTokens(catalog: Catalog): string[] {
  return [...new Set(catalog.packages.flatMap((p) => p.destinationTokens.map((t) => t.toLowerCase())))]
}

// Same set, title-cased for display in a customer-facing message (orchestrator.ts's
// clarifying question) -- "tumpak sewu" -> "Tumpak Sewu".
export function listDestinations(catalog: Catalog): string[] {
  return allDestinationTokens(catalog).map((t) => t.replace(/\b\w/g, (c) => c.toUpperCase()))
}

/**
 * Finds every package covering the single destination mentioned earliest in the
 * message. A package matches on ANY of its `destinationTokens`, so a combined
 * Bromo+Ijen tour is offered to a customer who asked about either. Returns `null`
 * when no known destination is mentioned at all -- the caller (orchestrator.ts)
 * treats that the same way route-gate.ts's own "no destination" branch already
 * does: hand off, rather than run a clarifying-question dialogue of its own.
 */
export function matchDestination(message: string, catalog: Catalog): { destination: string; matches: CatalogPackage[] } | null {
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

/**
 * Every package matching a known destination (used when the destination came from
 * `tripBrief` rather than a fresh match this turn, so there is no `matches` array
 * already in hand).
 */
export function packagesForDestination(destination: string, catalog: Catalog): CatalogPackage[] {
  const wanted = destination.toLowerCase()
  return catalog.packages.filter((p) => p.destinationTokens.some((t) => t.toLowerCase() === wanted))
}

/**
 * Among a destination's matching packages, the one orchestrator.ts should
 * answer about. Prefers a priced package -- matching route-gate.ts's own "no
 * priced match -> handoff" rule, so the package chosen here is always one
 * route-gate would actually let through -- falling back to the first match so
 * there is still *a* package for orchestrator.ts to name if every match is
 * unpriced (route-gate will already have handed off before this runs in that case).
 */
export function pickPackage(matches: CatalogPackage[]): CatalogPackage {
  return matches.find((p) => p.priceIdr !== null) ?? matches[0]
}

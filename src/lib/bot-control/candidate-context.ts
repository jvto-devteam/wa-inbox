/**
 * Runs a block of work as if a set of DRAFT versions were already published.
 *
 * --- The problem this solves ---
 *
 * `POST /api/bot-control/test-runs` has always accepted a `candidate` body — the rule drafts,
 * knowledge revisions and flow versions a publish is about to ship — and always discarded it.
 * The suite therefore ran against configuration that was ALREADY LIVE, so the gate in front of
 * every publish verified the thing being replaced rather than the thing being shipped.
 *
 * --- Why AsyncLocalStorage and not a parameter ---
 *
 * The three loaders that decide what the bot reads (`runtime-rules`, `runtime-flows`,
 * `managed-knowledge`) are called from inside `orchestrator.ts`, several layers below the test
 * runner and behind a 1,700-line control flow whose shape is the product. Threading a candidate
 * through every frame would mean touching all of it. A module-level variable would be worse
 * than useless: Node serves requests concurrently in one process, so a candidate set for a test
 * run would apply to any customer message that happened to be mid-turn.
 *
 * AsyncLocalStorage scopes the override to one async call tree. A concurrent customer turn is a
 * different tree and sees nothing.
 *
 * --- The caching rule, which is the safety-critical part ---
 *
 * Every loader here MUST bypass its cache in both directions while a candidate is active: it
 * must not read a cached published value (that would silently ignore the candidate), and above
 * all it must not WRITE what it computed. A candidate config written into a 30-second cache
 * would be served to real customers by every other request in the process. Each loader states
 * this at its own cache check.
 */
import { AsyncLocalStorage } from 'node:async_hooks'

export type CandidateVersions = {
  /** Rule keys whose DRAFT values should stand in for their published ones. */
  ruleDraftKeys?: string[]
  /** KnowledgeRevision ids to use instead of the published revision of the same source. */
  knowledgeRevisionIds?: string[]
  /** BotFlowVersion ids to use instead of the published version of the same flow. */
  flowVersionIds?: string[]
}

const storage = new AsyncLocalStorage<CandidateVersions>()

function isEmpty(candidate: CandidateVersions): boolean {
  return (
    (candidate.ruleDraftKeys?.length ?? 0) === 0 &&
    (candidate.knowledgeRevisionIds?.length ?? 0) === 0 &&
    (candidate.flowVersionIds?.length ?? 0) === 0
  )
}

/**
 * Runs `fn` with the candidate versions in scope.
 *
 * An absent or empty candidate runs `fn` with NO store at all rather than an empty one, so the
 * loaders' fast path (`getCandidateVersions() === null`) stays the common case and keeps its
 * cache.
 */
export function runWithCandidateVersions<T>(
  candidate: CandidateVersions | null | undefined,
  fn: () => Promise<T>
): Promise<T> {
  if (!candidate || isEmpty(candidate)) return fn()
  return storage.run(candidate, fn)
}

/** The candidate versions in scope, or null when this is ordinary traffic. */
export function getCandidateVersions(): CandidateVersions | null {
  return storage.getStore() ?? null
}

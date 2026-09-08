/**
 * Runs a block of work as if a set of DRAFT versions were already published.
 *
 * --- The problem this solves ---
 *
 * Anything that wants to exercise the bot against configuration that is approved but not yet
 * live — a pre-publish dry run, a preview — otherwise reads whatever is ALREADY LIVE, and so
 * describes the thing being replaced rather than the thing being shipped.
 *
 * The batch test runner that first needed this is gone (its cases were never written, so every
 * run passed without checking anything). This stays because the loaders below are built around
 * it: removing the hook would mean editing them to prove nothing, and the next caller that
 * needs a candidate would have to put it back.
 *
 * --- Why AsyncLocalStorage and not a parameter ---
 *
 * The loader that decides what the bot reads (`managed-knowledge`) is called from inside
 * `orchestrator.ts`, several layers below any caller and behind a 1,700-line control flow whose
 * shape is the product. Threading a candidate through every frame would mean touching all of
 * it. A module-level variable would be worse than useless: Node serves requests concurrently in
 * one process, so a candidate set for one dry run would apply to any customer message that
 * happened to be mid-turn.
 *
 * AsyncLocalStorage scopes the override to one async call tree. A concurrent customer turn is a
 * different tree and sees nothing.
 *
 * --- The caching rule, which is the safety-critical part ---
 *
 * Every loader MUST bypass its cache in both directions while a candidate is active: it
 * must not read a cached published value (that would silently ignore the candidate), and above
 * all it must not WRITE what it computed. A candidate config written into a 30-second cache
 * would be served to real customers by every other request in the process. Each loader states
 * this at its own cache check.
 */
import { AsyncLocalStorage } from 'node:async_hooks'

export type CandidateVersions = {
  /** KnowledgeRevision ids to use instead of the published revision of the same source. */
  knowledgeRevisionIds?: string[]
}

const storage = new AsyncLocalStorage<CandidateVersions>()

function isEmpty(candidate: CandidateVersions): boolean {
  return (candidate.knowledgeRevisionIds?.length ?? 0) === 0
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

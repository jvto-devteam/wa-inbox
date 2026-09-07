/**
 * Reads a flow's live safe config, for code that has to act on it.
 *
 * Same contract as runtime-rules.ts and managed-knowledge.ts, and for the same reason: this is
 * read inside a bot turn, so it caches for thirty seconds and it never throws. A database
 * outage returns the code's own defaults, logged — the bot has always run on those, and a turn
 * that dies because a CONFIGURATION lookup failed is a far worse outcome than one running on
 * last week's wording.
 *
 * --- The registry is the base layer, not a last resort ---
 *
 * `existing-flow-registry.ts` decides which flows exist and what steps they contain, because
 * those are control flow in `orchestrator.ts`, not data. A database row may override only the
 * seven safe-config values. A row whose key is not in the registry is ignored entirely: that is
 * a flow deleted from the code, and honouring its config would configure nothing.
 */
import { prisma } from '@/lib/db'
import { getExistingFlow, listExistingFlows } from '@/lib/bot-control/existing-flow-registry'
import { readFlowSafeConfig, type FlowSafeConfig } from '@/lib/bot-control/flow-config'

/** SDD Manage Second §18.1, matching the rule and knowledge loaders. */
export const FLOW_CACHE_TTL_MS = 30_000

export type RuntimeFlow = {
  key: string
  name: string
  editableLevel: string
  /** The published safe config, or an empty object when the code's defaults still apply. */
  config: FlowSafeConfig
  activeVersion: number | null
  /** 'database' when a published version supplied the config, 'code' otherwise. */
  source: 'database' | 'code'
}

type CacheEntry = { value: Map<string, RuntimeFlow>; expiresAt: number }
let cache: CacheEntry | null = null

/** Drops the cache. Called after a publish so an operator sees their change take effect. */
export function invalidateRuntimeFlowCache(): void {
  cache = null
}

function staticFlows(): Map<string, RuntimeFlow> {
  const flows = new Map<string, RuntimeFlow>()
  for (const flow of listExistingFlows()) {
    flows.set(flow.key, {
      key: flow.key,
      name: flow.name,
      // The registry describes code, and code is not editable from a form until a seeded row
      // says otherwise. Defaulting to READ_ONLY means a missing row fails closed.
      editableLevel: 'READ_ONLY',
      config: {},
      activeVersion: null,
      source: 'code',
    })
  }
  return flows
}

async function loadFlows(now: number): Promise<Map<string, RuntimeFlow>> {
  if (cache && cache.expiresAt > now) return cache.value

  const fallback = staticFlows()

  // Whole body guarded — see runtime-rules.ts for what a partially-guarded loader did to a turn.
  try {
    const rows = await prisma.botFlowDefinition.findMany({
      where: { status: { not: 'ARCHIVED' } },
      select: {
        key: true,
        name: true,
        editableLevel: true,
        activeVersionId: true,
        // Only the published one. A draft reaching the bot is the failure this whole workflow
        // exists to prevent.
        versions: {
          where: { status: 'PUBLISHED' },
          orderBy: { version: 'desc' },
          take: 1,
          select: { id: true, version: true, nodeConfig: true },
        },
      },
    })
    if (!Array.isArray(rows)) return fallback

    const flows = new Map(fallback)
    for (const row of rows) {
      const base = flows.get(row.key)
      // A flow the registry no longer knows about: its config would configure nothing.
      if (!base) continue

      const published = row.versions?.[0]
      // A config this build cannot read falls back to the code's values rather than being passed
      // through half-understood.
      const config = published ? readFlowSafeConfig(published.nodeConfig) : null

      flows.set(row.key, {
        ...base,
        name: row.name,
        editableLevel: row.editableLevel,
        config: config ?? {},
        activeVersion: published?.version ?? null,
        source: config ? 'database' : 'code',
      })
    }

    cache = { value: flows, expiresAt: now + FLOW_CACHE_TTL_MS }
    return flows
  } catch (error) {
    // Not cached, so recovery is immediate once the database is back.
    console.error('runtime-flows: gagal membaca BotFlowDefinition, memakai registry statis', { error })
    return fallback
  }
}

/** Every flow, merged. */
export async function getRuntimeFlows(now: number = Date.now()): Promise<RuntimeFlow[]> {
  return [...(await loadFlows(now)).values()]
}

/** One flow's live configuration, or null when the registry has no such flow. */
export async function getActiveFlowConfig(key: string, now: number = Date.now()): Promise<RuntimeFlow | null> {
  // Checked against the registry first: a database row for a key the code does not implement
  // must not conjure a flow into existence.
  if (!getExistingFlow(key)) return null
  return (await loadFlows(now)).get(key) ?? null
}

/**
 * One safe-config value, or the caller's own default.
 *
 * An empty string counts as absent, not as "say nothing" — clearing a box in the editor means
 * "go back to the code's wording", and making an operator retype the original sentence to
 * revert is how a typo becomes permanent.
 */
export async function getFlowText(
  key: string,
  field: 'greetingText' | 'clarificationPrompt' | 'fallbackReply' | 'handoffReply' | 'workingHoursReply',
  fallback: string
): Promise<string> {
  const flow = await getActiveFlowConfig(key)
  const value = flow?.config[field]
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback
}

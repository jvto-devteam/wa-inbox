/**
 * Brings `BotFlowDefinition` in line with the static flow registry.
 *
 * Mirrors rule-seed.ts, including the split that matters: the registry owns the flow's
 * identity (name, description, and above all `editableLevel`), and the seed re-asserts it on
 * every run. `editableLevel` in particular has to be rewritten each time — a stale
 * `FLOW_BUILDER_V1` left in the database on a flow the code has since restricted would offer an
 * operator controls the runtime does not honour.
 *
 * What the seed never touches is `activeVersionId` or any version row. Those are what an
 * operator published; a routine seed that reverted them would be an unattributed rollback.
 */
import { prisma } from '@/lib/db'
import { EXISTING_FLOWS } from '@/lib/bot-control/existing-flow-registry'
import { writeBotAuditLog } from '@/lib/bot-control/audit'
import { SEED_ACTOR_ID, SEED_ACTOR_NAME, RUNTIME_SOURCE_CODE } from '@/lib/bot-control/rule-seed'

/**
 * Editable level per flow key.
 *
 * SAFE_CONFIG for the existing WhatsApp bot: its greeting, clarification prompt, fallback and
 * handoff wording are values the code reads verbatim, so changing them from a form changes
 * exactly what it says it changes. Its branching is not here and will not be until Flow Builder
 * V1 — see flow-config.ts.
 *
 * A flow absent from this map seeds as READ_ONLY, which is the correct default: opening a flow
 * for editing has to be a deliberate act, and forgetting one fails closed.
 */
const EDITABLE_LEVELS: Record<string, string> = {
  'whatsapp-existing-bot-v1': 'SAFE_CONFIG',
}

const DEFAULT_CATEGORY = 'WhatsApp'

export type FlowSeedResult = { created: number; updated: number; unchanged: number }

export async function seedBotFlowDefinitions(): Promise<FlowSeedResult> {
  const result: FlowSeedResult = { created: 0, updated: 0, unchanged: 0 }

  for (const flow of EXISTING_FLOWS) {
    const identity = {
      name: flow.name,
      description: flow.description,
      category: DEFAULT_CATEGORY,
      editableLevel: EDITABLE_LEVELS[flow.key] ?? 'READ_ONLY',
    }

    const existing = await prisma.botFlowDefinition.findUnique({ where: { key: flow.key } })

    if (!existing) {
      const created = await prisma.botFlowDefinition.create({
        data: {
          key: flow.key,
          ...identity,
          // No version yet: the bot is running on the code's own wording, and saying
          // "database" before anything has been published would be a lie the loader repeats.
          runtimeSource: RUNTIME_SOURCE_CODE,
          status: 'PUBLISHED',
        },
        select: { id: true },
      })
      result.created += 1

      await writeBotAuditLog({
        action: 'CREATE_DRAFT',
        entityType: 'FLOW',
        entityId: created.id,
        entityKey: flow.key,
        actorId: SEED_ACTOR_ID,
        actorName: SEED_ACTOR_NAME,
        after: identity,
        reason: 'Baseline dari existing-flow-registry.ts',
      })
      continue
    }

    const drifted =
      existing.name !== identity.name ||
      existing.description !== identity.description ||
      existing.category !== identity.category ||
      existing.editableLevel !== identity.editableLevel

    if (!drifted) {
      result.unchanged += 1
      continue
    }

    await prisma.botFlowDefinition.update({ where: { key: flow.key }, data: identity })
    result.updated += 1

    await writeBotAuditLog({
      action: 'UPDATE_DRAFT',
      entityType: 'FLOW',
      entityId: existing.id,
      entityKey: flow.key,
      actorId: SEED_ACTOR_ID,
      actorName: SEED_ACTOR_NAME,
      before: {
        name: existing.name,
        description: existing.description,
        category: existing.category,
        editableLevel: existing.editableLevel,
      },
      after: identity,
      reason: 'Sinkronisasi metadata dari existing-flow-registry.ts',
    })
  }

  return result
}

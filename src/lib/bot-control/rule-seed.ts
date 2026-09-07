/**
 * Brings `BotRuleSetting` in line with the static registry.
 *
 * --- What it will and will not overwrite ---
 *
 * The identity half of a rule — name, category, description, severity, and above all
 * `editable` — is ALWAYS rewritten from the registry. Those describe what the rule is and
 * where it is enforced, and the registry is the only thing that knows. `editable` in
 * particular has to be re-asserted on every run: a stale `true` in the database would make a
 * rule that code no longer allows to be changed look changeable in the UI.
 *
 * The state half — `config`, `enabled`, and anything about a draft — is written ONLY when the
 * row is created. Re-running this must never revert an operator's published change back to the
 * code default; that would make a routine seed a silent, unattributed rollback of somebody's
 * deliberate decision.
 *
 * --- Why it audits itself ---
 *
 * The seed is the first thing that ever writes these rows, so without an audit entry the
 * earliest history of every rule would read as though it had always been that way. `system` is
 * named explicitly as the actor for the same reason: an empty actor is indistinguishable from
 * a lost one.
 */
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { listBotRules } from '@/lib/bot-control/rule-registry'
import { writeBotAuditLog } from '@/lib/bot-control/audit'

export const SEED_ACTOR_ID = 'system'
export const SEED_ACTOR_NAME = 'Seed otomatis'

/** Where the value in `config`/`enabled` came from. */
export const RUNTIME_SOURCE_CODE = 'code'
export const RUNTIME_SOURCE_DATABASE = 'database'

export type SeedResult = {
  created: number
  updated: number
  /** Rows left exactly as they were, because nothing in the registry half had changed. */
  unchanged: number
}

export async function seedBotRuleSettings(): Promise<SeedResult> {
  const result: SeedResult = { created: 0, updated: 0, unchanged: 0 }

  for (const rule of listBotRules()) {
    const existing = await prisma.botRuleSetting.findUnique({ where: { key: rule.key } })

    // The fields the registry owns outright.
    const identity = {
      name: rule.name,
      category: rule.category,
      description: rule.description,
      severity: rule.severity,
      editable: rule.editable,
    }

    if (!existing) {
      const created = await prisma.botRuleSetting.create({
        data: {
          key: rule.key,
          ...identity,
          // Baseline: the row starts out saying exactly what the code already does.
          enabled: rule.enabled,
          config: (rule.config ?? undefined) as Prisma.InputJsonValue | undefined,
          runtimeSource: RUNTIME_SOURCE_CODE,
          status: 'PUBLISHED',
        },
        select: { id: true },
      })
      result.created += 1

      await writeBotAuditLog({
        action: 'CREATE_DRAFT',
        entityType: 'RULE',
        entityId: created.id,
        entityKey: rule.key,
        actorId: SEED_ACTOR_ID,
        actorName: SEED_ACTOR_NAME,
        after: { ...identity, enabled: rule.enabled, config: rule.config ?? null, status: 'PUBLISHED' },
        reason: 'Baseline dari rule-registry.ts',
      })
      continue
    }

    const drifted =
      existing.name !== identity.name ||
      existing.category !== identity.category ||
      existing.description !== identity.description ||
      existing.severity !== identity.severity ||
      existing.editable !== identity.editable

    if (!drifted) {
      result.unchanged += 1
      continue
    }

    await prisma.botRuleSetting.update({ where: { key: rule.key }, data: identity })
    result.updated += 1

    await writeBotAuditLog({
      action: 'UPDATE_DRAFT',
      entityType: 'RULE',
      entityId: existing.id,
      entityKey: rule.key,
      actorId: SEED_ACTOR_ID,
      actorName: SEED_ACTOR_NAME,
      before: {
        name: existing.name,
        category: existing.category,
        description: existing.description,
        severity: existing.severity,
        editable: existing.editable,
      },
      after: identity,
      reason: 'Sinkronisasi metadata dari rule-registry.ts',
    })
  }

  return result
}

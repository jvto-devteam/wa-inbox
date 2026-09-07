/**
 * Moving a flow's safe config through draft → review → approve → publish.
 *
 * Structurally the same as knowledge-workflow.ts, and for the same reasons: a published version
 * is immutable history (a release snapshot naming it must keep describing what the bot actually
 * ran), re-editing an APPROVED draft sends it back to DRAFT, and nothing here changes runtime.
 *
 * The one thing that differs is the gate. Knowledge is checked for shape; a flow is checked for
 * shape AND for whether the flow's `editableLevel` permits the specific fields being changed.
 * That level is read from the DEFINITION row, which the seed rewrites from the static registry
 * on every run — so a row cannot raise its own level and unlock fields the code does not honour.
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { writeBotAuditLog, type AuditAction } from '@/lib/bot-control/audit'
import { getExistingFlow } from '@/lib/bot-control/existing-flow-registry'
import { validateFlowSafeConfig, type FlowSafeConfig } from '@/lib/bot-control/flow-config'

export const FLOW_VERSION_STATUSES = ['DRAFT', 'REVIEW', 'APPROVED', 'PUBLISHED', 'ARCHIVED', 'REJECTED'] as const
export type FlowVersionStatus = (typeof FLOW_VERSION_STATUSES)[number]

const ALLOWED_FROM: Record<'DRAFT' | 'REVIEW' | 'APPROVE' | 'REJECT', readonly FlowVersionStatus[]> = {
  DRAFT: ['DRAFT', 'REVIEW', 'APPROVED', 'REJECTED'],
  REVIEW: ['DRAFT', 'REJECTED'],
  APPROVE: ['REVIEW'],
  REJECT: ['DRAFT', 'REVIEW', 'APPROVED'],
}

export class FlowNotFoundError extends Error {
  constructor(message = 'Flow tidak ditemukan. Jalankan seed flow terlebih dahulu.') {
    super(message)
    this.name = 'FlowNotFoundError'
  }
}

export class FlowNotEditableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FlowNotEditableError'
  }
}

export class FlowTransitionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FlowTransitionError'
  }
}

export type Actor = { id: string; name: string | null }

export type FlowVersionResult = {
  key: string
  versionId: string
  version: number
  status: string
  config: FlowSafeConfig
}

/** Audit-sized description of a version. Never the whole config blob — see audit.ts. */
function versionFields(row: { version: number; status: string; nodeConfig: unknown }) {
  return { version: row.version, status: row.status, config: row.nodeConfig }
}

function asConfig(value: unknown): FlowSafeConfig {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as FlowSafeConfig
}

/**
 * Writes the flow's editable version, creating a new one when the last is published.
 *
 * Checks the REGISTRY as well as the database row: a flow whose key the code no longer
 * implements has nothing to configure, and letting a draft be written against it would produce
 * a version that publishes into a vacuum.
 */
export async function saveFlowDraft(
  key: string,
  input: { config: unknown; reason: string },
  actor: Actor,
  req?: Request
): Promise<FlowVersionResult> {
  if (!getExistingFlow(key)) throw new FlowNotFoundError(`Flow ${key} tidak ada di registry.`)

  const definition = await prisma.botFlowDefinition.findUnique({ where: { key } })
  if (!definition) throw new FlowNotFoundError()
  if (definition.status === 'ARCHIVED') {
    throw new FlowNotEditableError('Flow ini sudah diarsipkan.')
  }

  const validated = validateFlowSafeConfig(definition.editableLevel, input.config)
  if (!validated.ok) throw new FlowNotEditableError(validated.error)

  const latest = await prisma.botFlowVersion.findFirst({
    where: { flowId: definition.id },
    orderBy: { version: 'desc' },
  })

  const nodeConfig = validated.config as unknown as Prisma.InputJsonValue

  // No version at all yet: the flow has only ever run on the code's own values.
  if (!latest) {
    const created = await prisma.botFlowVersion.create({
      data: {
        flowId: definition.id,
        version: 1,
        status: 'DRAFT',
        nodeConfig,
        changeReason: input.reason,
        createdBy: actor.id,
      },
    })

    await writeBotAuditLog({
      action: 'CREATE_DRAFT',
      entityType: 'FLOW',
      entityId: definition.id,
      entityKey: key,
      actorId: actor.id,
      actorName: actor.name,
      after: versionFields(created),
      reason: input.reason,
      req,
    })

    return { key, versionId: created.id, version: created.version, status: created.status, config: validated.config }
  }

  if (ALLOWED_FROM.DRAFT.includes(latest.status as FlowVersionStatus)) {
    const updated = await prisma.botFlowVersion.update({
      where: { id: latest.id },
      data: {
        // Back to DRAFT even from APPROVED: approval attaches to particular values.
        status: 'DRAFT',
        nodeConfig,
        changeReason: input.reason,
        createdBy: actor.id,
        reviewedBy: null,
        reviewedAt: null,
      },
    })

    await writeBotAuditLog({
      action: 'UPDATE_DRAFT',
      entityType: 'FLOW',
      entityId: definition.id,
      entityKey: key,
      actorId: actor.id,
      actorName: actor.name,
      before: versionFields(latest),
      after: versionFields(updated),
      reason: input.reason,
      req,
    })

    return { key, versionId: updated.id, version: updated.version, status: updated.status, config: validated.config }
  }

  // The latest version is PUBLISHED or ARCHIVED — history now, so a change means a new version.
  const created = await prisma.botFlowVersion.create({
    data: {
      flowId: definition.id,
      version: latest.version + 1,
      status: 'DRAFT',
      nodeConfig,
      changeReason: input.reason,
      createdBy: actor.id,
    },
  })

  await writeBotAuditLog({
    action: 'CREATE_DRAFT',
    entityType: 'FLOW',
    entityId: definition.id,
    entityKey: key,
    actorId: actor.id,
    actorName: actor.name,
    before: versionFields(latest),
    after: versionFields(created),
    reason: input.reason,
    req,
  })

  return { key, versionId: created.id, version: created.version, status: created.status, config: validated.config }
}

/** Moves the flow's pending version between review states. */
export async function transitionFlow(
  key: string,
  transition: 'REVIEW' | 'APPROVE' | 'REJECT',
  actor: Actor,
  reason: string | null,
  req?: Request
): Promise<FlowVersionResult> {
  const definition = await prisma.botFlowDefinition.findUnique({ where: { key } })
  if (!definition) throw new FlowNotFoundError()

  const latest = await prisma.botFlowVersion.findFirst({
    where: { flowId: definition.id },
    orderBy: { version: 'desc' },
  })
  if (!latest) throw new FlowNotFoundError('Flow ini belum punya draft konfigurasi.')

  if (!ALLOWED_FROM[transition].includes(latest.status as FlowVersionStatus)) {
    throw new FlowTransitionError(
      `Versi v${latest.version} berstatus ${latest.status}; transisi ${transition} tidak diizinkan dari sana.`
    )
  }

  const nextStatus: FlowVersionStatus =
    transition === 'REVIEW' ? 'REVIEW' : transition === 'APPROVE' ? 'APPROVED' : 'REJECTED'

  const updated = await prisma.botFlowVersion.update({
    where: { id: latest.id },
    data:
      transition === 'APPROVE'
        ? { status: nextStatus, reviewedBy: actor.id, reviewedAt: new Date() }
        : // A rejected version is KEPT, like a knowledge revision and unlike a rule draft: it
          // records a configuration somebody proposed and a reviewer refused, which is usually
          // the explanation for why the current wording is what it is.
          { status: nextStatus, changeReason: reason ?? latest.changeReason },
  })

  const action: AuditAction =
    transition === 'REVIEW' ? 'REQUEST_REVIEW' : transition === 'APPROVE' ? 'APPROVE' : 'REJECT'

  await writeBotAuditLog({
    action,
    entityType: 'FLOW',
    entityId: definition.id,
    entityKey: key,
    actorId: actor.id,
    actorName: actor.name,
    before: versionFields(latest),
    after: versionFields(updated),
    reason,
    req,
  })

  return {
    key,
    versionId: updated.id,
    version: updated.version,
    status: updated.status,
    config: asConfig(updated.nodeConfig),
  }
}

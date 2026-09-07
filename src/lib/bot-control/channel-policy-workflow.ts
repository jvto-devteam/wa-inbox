/**
 * Draft → review → approve → publish for the channel policy.
 *
 * Structurally the same as the rule workflow, including the part that matters: the draft lives
 * in `draftConfig`, beside the live columns rather than on top of them, so "a draft has not
 * changed the send path" is a property of the data rather than something every reader has to
 * remember. Publish moves it across, inside the release transaction.
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { writeBotAuditLog, type AuditAction } from '@/lib/bot-control/audit'
import {
  DEFAULT_CHANNEL_POLICY,
  DEFAULT_CHANNEL_POLICY_KEY,
  policyWarnings,
  readChannelPolicy,
  validateChannelPolicyDraft,
  type ChannelPolicyDraft,
} from '@/lib/bot-control/channel-policy-config'

export const POLICY_STATUSES = ['PUBLISHED', 'DRAFT', 'REVIEW', 'APPROVED', 'REJECTED'] as const
export type PolicyStatus = (typeof POLICY_STATUSES)[number]

const ALLOWED_FROM: Record<'DRAFT' | 'REVIEW' | 'APPROVE' | 'REJECT', readonly PolicyStatus[]> = {
  DRAFT: ['PUBLISHED', 'DRAFT', 'REVIEW', 'APPROVED', 'REJECTED'],
  REVIEW: ['DRAFT', 'REJECTED'],
  APPROVE: ['REVIEW'],
  REJECT: ['DRAFT', 'REVIEW', 'APPROVED'],
}

export class PolicyNotFoundError extends Error {
  constructor() {
    super('Kebijakan channel belum di-seed.')
    this.name = 'PolicyNotFoundError'
  }
}

export class PolicyInvalidError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PolicyInvalidError'
  }
}

export class PolicyTransitionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PolicyTransitionError'
  }
}

export type Actor = { id: string; name: string | null }

export type PolicyResult = {
  key: string
  status: string
  active: ChannelPolicyDraft
  draft: ChannelPolicyDraft | null
  warnings: string[]
}

/** Audit-sized description. Never the whole policy blob — see audit.ts. */
function policyFields(row: { status: string; defaultOutbound: string; draftConfig: unknown }) {
  return { status: row.status, defaultOutbound: row.defaultOutbound, hasDraft: row.draftConfig !== null }
}

/** Seeds the default row. Idempotent, and never overwrites a policy somebody has published. */
export async function seedChannelPolicy(): Promise<{ created: boolean }> {
  const existing = await prisma.channelPolicySetting.findUnique({ where: { key: DEFAULT_CHANNEL_POLICY_KEY } })
  if (existing) return { created: false }

  const created = await prisma.channelPolicySetting.create({
    data: {
      key: DEFAULT_CHANNEL_POLICY_KEY,
      defaultOutbound: DEFAULT_CHANNEL_POLICY.defaultOutbound,
      officialMode: DEFAULT_CHANNEL_POLICY.officialMode,
      unofficialMode: DEFAULT_CHANNEL_POLICY.unofficialMode,
      capabilityRules: DEFAULT_CHANNEL_POLICY.capabilityRules as Prisma.InputJsonValue,
      safetyConfig: DEFAULT_CHANNEL_POLICY.safetyConfig as Prisma.InputJsonValue,
      status: 'PUBLISHED',
    },
    select: { id: true },
  })

  await writeBotAuditLog({
    action: 'CREATE_DRAFT',
    entityType: 'CHANNEL_POLICY',
    entityId: created.id,
    entityKey: DEFAULT_CHANNEL_POLICY_KEY,
    actorId: 'system',
    actorName: 'Seed otomatis',
    after: { defaultOutbound: DEFAULT_CHANNEL_POLICY.defaultOutbound, status: 'PUBLISHED' },
    reason: 'Baseline dari SDD Manage Second §7.11',
  })

  return { created: true }
}

/** Reads the row and its draft, both parsed. Falls back to the code defaults for the active side. */
export async function getChannelPolicyState(): Promise<PolicyResult> {
  const row = await prisma.channelPolicySetting.findUnique({ where: { key: DEFAULT_CHANNEL_POLICY_KEY } })
  if (!row) throw new PolicyNotFoundError()

  const active =
    readChannelPolicy({
      defaultOutbound: row.defaultOutbound,
      officialMode: row.officialMode,
      unofficialMode: row.unofficialMode,
      capabilityRules: row.capabilityRules,
      safetyConfig: row.safetyConfig,
    }) ?? DEFAULT_CHANNEL_POLICY

  const draft = readChannelPolicy(row.draftConfig)

  return {
    key: row.key,
    status: row.status,
    active,
    draft,
    // Warnings describe whatever an operator is about to ship: the draft when there is one,
    // otherwise what is already live.
    warnings: policyWarnings(draft ?? active),
  }
}

export async function saveChannelPolicyDraft(
  input: { config: unknown; reason: string },
  actor: Actor,
  req?: Request
): Promise<PolicyResult> {
  const row = await prisma.channelPolicySetting.findUnique({ where: { key: DEFAULT_CHANNEL_POLICY_KEY } })
  if (!row) throw new PolicyNotFoundError()

  const validated = validateChannelPolicyDraft(input.config)
  if (!validated.ok) throw new PolicyInvalidError(validated.error)

  if (!ALLOWED_FROM.DRAFT.includes(row.status as PolicyStatus)) {
    throw new PolicyTransitionError(`Kebijakan sedang berstatus ${row.status} dan tidak bisa diubah.`)
  }

  await prisma.channelPolicySetting.update({
    where: { key: DEFAULT_CHANNEL_POLICY_KEY },
    data: {
      // Back to DRAFT even from APPROVED: approval attaches to particular values.
      status: 'DRAFT',
      draftConfig: validated.draft as unknown as Prisma.InputJsonValue,
      draftUpdatedBy: actor.id,
      draftUpdatedAt: new Date(),
    },
  })

  await writeBotAuditLog({
    action: row.draftUpdatedAt ? 'UPDATE_DRAFT' : 'CREATE_DRAFT',
    entityType: 'CHANNEL_POLICY',
    entityId: row.id,
    entityKey: row.key,
    actorId: actor.id,
    actorName: actor.name,
    before: policyFields(row),
    after: { status: 'DRAFT', defaultOutbound: validated.draft.defaultOutbound, hasDraft: true },
    reason: input.reason,
    req,
  })

  return getChannelPolicyState()
}

export async function transitionChannelPolicy(
  transition: 'REVIEW' | 'APPROVE' | 'REJECT',
  actor: Actor,
  reason: string | null,
  req?: Request
): Promise<PolicyResult> {
  const row = await prisma.channelPolicySetting.findUnique({ where: { key: DEFAULT_CHANNEL_POLICY_KEY } })
  if (!row) throw new PolicyNotFoundError()

  if (!ALLOWED_FROM[transition].includes(row.status as PolicyStatus)) {
    throw new PolicyTransitionError(
      `Kebijakan berstatus ${row.status}; transisi ${transition} tidak diizinkan dari sana.`
    )
  }
  if (transition !== 'REJECT' && row.draftConfig === null) {
    throw new PolicyTransitionError('Belum ada draft kebijakan yang bisa diproses.')
  }

  const nextStatus: PolicyStatus =
    transition === 'REVIEW' ? 'REVIEW' : transition === 'APPROVE' ? 'APPROVED' : 'REJECTED'

  await prisma.channelPolicySetting.update({
    where: { key: DEFAULT_CHANNEL_POLICY_KEY },
    data:
      transition === 'REJECT'
        ? // Discarded, like a rejected rule draft and unlike a knowledge revision: a policy
          // draft is a handful of settings, not written prose, and keeping a rejected one
          // invites somebody to approve it later without re-reading why it was refused.
          { status: 'REJECTED', draftConfig: Prisma.DbNull, draftUpdatedAt: null, draftUpdatedBy: null }
        : { status: nextStatus },
  })

  const action: AuditAction =
    transition === 'REVIEW' ? 'REQUEST_REVIEW' : transition === 'APPROVE' ? 'APPROVE' : 'REJECT'

  await writeBotAuditLog({
    action,
    entityType: 'CHANNEL_POLICY',
    entityId: row.id,
    entityKey: row.key,
    actorId: actor.id,
    actorName: actor.name,
    before: policyFields(row),
    after: { status: nextStatus, defaultOutbound: row.defaultOutbound, hasDraft: transition !== 'REJECT' },
    reason,
    req,
  })

  return getChannelPolicyState()
}

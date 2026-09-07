/**
 * @vitest-environment node
 *
 * The whole lifecycle, end to end: seed → draft → review → approve → publish → runtime.
 *
 * The unit tests around this each mock the step before them, which means none of them can
 * catch the failure that actually matters here — a break in the JOIN between two steps. A
 * publish that writes `config` while the runtime loader reads `draftConfig`, or a reject that
 * leaves a draft the publisher still picks up, passes every unit test in this directory and
 * ships a bot running configuration nobody approved.
 *
 * So this test drives the real functions against a small in-memory store rather than a
 * per-call mock. The store is deliberately dumb: it only has to be consistent between steps,
 * which is precisely the property being tested.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'

type Row = Record<string, unknown>

/** Two tables' worth of state, shared by every call in one test. */
const store = {
  rules: new Map<string, Row>(),
  releases: [] as Row[],
  audits: [] as Row[],
  // Phase D added knowledge to the same publish transaction; the store has to cover it or the
  // rule lifecycle can no longer be exercised at all.
  knowledgeRevisions: [] as Row[],
  knowledgeSources: [] as Row[],
  // Phase E put flows in the same publish transaction, for the same reason.
  flowVersions: [] as Row[],
  flowDefinitions: [] as Row[],
}

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true
  return Object.entries(where).every(([field, expected]) => row[field] === expected)
}

/** Prisma writes `Prisma.DbNull` into Json columns; reads come back as plain null. */
function normalise(data: Row): Row {
  const out: Row = {}
  for (const [field, value] of Object.entries(data)) out[field] = value === Prisma.DbNull ? null : value
  return out
}

const db = {
  botRuleSetting: {
    findUnique: async ({ where }: { where: { key: string } }) => store.rules.get(where.key) ?? null,
    findMany: async (args?: { where?: Row }) => [...store.rules.values()].filter((row) => matches(row, args?.where)),
    create: async ({ data }: { data: Row }) => {
      const row = normalise({ id: `brs_${store.rules.size + 1}`, ...data })
      store.rules.set(row.key as string, row)
      return row
    },
    update: async ({ where, data }: { where: { key: string }; data: Row }) => {
      const row = { ...store.rules.get(where.key), ...normalise(data) }
      store.rules.set(where.key, row)
      return row
    },
  },
  botRelease: {
    findFirst: async (args?: { where?: Row; orderBy?: Row }) => {
      const rows = store.releases.filter((row) => matches(row, args?.where))
      if (args?.orderBy && 'version' in args.orderBy) {
        return [...rows].sort((a, b) => (b.version as number) - (a.version as number))[0] ?? null
      }
      return rows[0] ?? null
    },
    findUnique: async ({ where }: { where: { id: string } }) => store.releases.find((r) => r.id === where.id) ?? null,
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      let count = 0
      for (const row of store.releases) {
        if (!matches(row, where)) continue
        Object.assign(row, data)
        count += 1
      }
      return { count }
    },
    update: async ({ where, data }: { where: { id: string }; data: Row }) => {
      const row = store.releases.find((r) => r.id === where.id)
      if (row) Object.assign(row, normalise(data))
      return row ?? {}
    },
    create: async ({ data }: { data: Row }) => {
      const row = normalise({ id: `rel_${store.releases.length + 1}`, publishedAt: new Date(), ...data })
      store.releases.push(row)
      return row
    },
  },
  knowledgeRevision: {
    findMany: async (args?: { where?: Row }) =>
      store.knowledgeRevisions.filter((row) => matches(row, args?.where ? { status: args.where.status } : undefined)),
    findUnique: async ({ where }: { where: { id: string } }) =>
      store.knowledgeRevisions.find((r) => r.id === where.id) ?? null,
    updateMany: async () => ({ count: 0 }),
    update: async ({ where, data }: { where: { id: string }; data: Row }) => {
      const row = store.knowledgeRevisions.find((r) => r.id === where.id)
      if (row) Object.assign(row, normalise(data))
      return row ?? {}
    },
  },
  knowledgeSource: {
    update: async ({ where, data }: { where: { id: string }; data: Row }) => {
      const row = store.knowledgeSources.find((r) => r.id === where.id)
      if (row) Object.assign(row, normalise(data))
      return row ?? {}
    },
  },
  botFlowVersion: {
    findMany: async (args?: { where?: Row }) =>
      store.flowVersions.filter((row) => matches(row, args?.where ? { status: args.where.status } : undefined)),
    findUnique: async ({ where }: { where: { id: string } }) =>
      store.flowVersions.find((r) => r.id === where.id) ?? null,
    updateMany: async () => ({ count: 0 }),
    update: async ({ where, data }: { where: { id: string }; data: Row }) => {
      const row = store.flowVersions.find((r) => r.id === where.id)
      if (row) Object.assign(row, normalise(data))
      return row ?? {}
    },
  },
  botFlowDefinition: {
    update: async ({ where, data }: { where: { id: string }; data: Row }) => {
      const row = store.flowDefinitions.find((r) => r.id === where.id)
      if (row) Object.assign(row, normalise(data))
      return row ?? {}
    },
  },
  botControlAuditLog: {
    create: async ({ data }: { data: Row }) => {
      const row = { id: `audit_${store.audits.length + 1}`, ...data }
      store.audits.push(row)
      return row
    },
  },
  // The lifecycle functions never branch on the transaction client's identity, so handing them
  // the same object is faithful here — atomicity itself is asserted in release.test.ts.
  $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
}

vi.mock('@/lib/db', () => ({ prisma: db }))

const { seedBotRuleSettings } = await import('./rule-seed')
const { saveRuleDraft, transitionRule } = await import('./rule-workflow')
const { publishRelease, previewRelease } = await import('./release')
const { getRuntimeRuleConfig, invalidateRuntimeRuleCache } = await import('./runtime-rules')
const { listBotRules } = await import('./rule-registry')

const actor = { id: 'acc_admin', name: 'Admin Satu' }
const EDITABLE_KEY = 'bot.handoff_on_human_request'
const REASON = 'Model klasifikasi handoff sedang tidak akurat'

beforeEach(async () => {
  store.rules.clear()
  store.releases.length = 0
  store.audits.length = 0
  store.knowledgeRevisions.length = 0
  store.knowledgeSources.length = 0
  store.flowVersions.length = 0
  store.flowDefinitions.length = 0
  invalidateRuntimeRuleCache()
  await seedBotRuleSettings()
})

describe('rule lifecycle', () => {
  it('seeds a baseline that matches the code exactly', async () => {
    expect(store.rules.size).toBe(listBotRules().length)

    const runtime = await getRuntimeRuleConfig()
    expect(runtime.source).toBe('database')
    for (const rule of listBotRules()) {
      expect(runtime.rules[rule.key].enabled, rule.key).toBe(rule.enabled)
    }
  })

  it('carries a change from draft all the way to the runtime, and only at publish', async () => {
    // Step 1: draft. The runtime must not move.
    await saveRuleDraft(EDITABLE_KEY, { enabled: false, reason: REASON }, actor)
    invalidateRuntimeRuleCache()
    expect((await getRuntimeRuleConfig()).rules[EDITABLE_KEY].enabled).toBe(true)
    expect(store.rules.get(EDITABLE_KEY)?.status).toBe('DRAFT')

    // Step 2: review. Still no movement.
    await transitionRule(EDITABLE_KEY, 'REVIEW', actor, null)
    invalidateRuntimeRuleCache()
    expect((await getRuntimeRuleConfig()).rules[EDITABLE_KEY].enabled).toBe(true)

    // Step 3: approve. Now, and only now, does preview count it.
    await transitionRule(EDITABLE_KEY, 'APPROVE', actor, null)
    expect((await previewRelease()).changes.rules).toBe(1)
    invalidateRuntimeRuleCache()
    expect((await getRuntimeRuleConfig()).rules[EDITABLE_KEY].enabled).toBe(true)

    // Step 4: publish. The change reaches the bot.
    await publishRelease({ title: 'Matikan klasifikasi handoff', actorId: actor.id, actorName: actor.name })
    const runtime = await getRuntimeRuleConfig()
    expect(runtime.rules[EDITABLE_KEY].enabled).toBe(false)
    expect(runtime.source).toBe('database')
  })

  it('leaves no draft behind after publishing, and nothing left to publish', async () => {
    await saveRuleDraft(EDITABLE_KEY, { enabled: false, reason: REASON }, actor)
    await transitionRule(EDITABLE_KEY, 'REVIEW', actor, null)
    await transitionRule(EDITABLE_KEY, 'APPROVE', actor, null)
    await publishRelease({ title: 'x', actorId: actor.id })

    const row = store.rules.get(EDITABLE_KEY)
    expect(row?.status).toBe('PUBLISHED')
    expect(row?.draftEnabled).toBeNull()
    expect(row?.draftUpdatedAt).toBeNull()
    expect((await previewRelease()).changes.rules).toBe(0)
  })

  it('records the release id on the rule and the rule in the release snapshot', async () => {
    await saveRuleDraft(EDITABLE_KEY, { enabled: false, reason: REASON }, actor)
    await transitionRule(EDITABLE_KEY, 'REVIEW', actor, null)
    await transitionRule(EDITABLE_KEY, 'APPROVE', actor, null)
    await publishRelease({ title: 'x', actorId: actor.id })

    const release = store.releases[0]
    expect(store.rules.get(EDITABLE_KEY)?.releaseId).toBe(release.id)

    // The snapshot is taken after the rules move, so it lists every rule now published.
    const snapshot = release.snapshot as { rules: { key: string }[] }
    expect(snapshot.rules.map((r) => r.key)).toContain(EDITABLE_KEY)
    expect(snapshot.rules).toHaveLength(listBotRules().length)
  })

  it('discards a rejected draft, so publish never picks it up', async () => {
    await saveRuleDraft(EDITABLE_KEY, { enabled: false, reason: REASON }, actor)
    await transitionRule(EDITABLE_KEY, 'REVIEW', actor, null)
    await transitionRule(EDITABLE_KEY, 'REJECT', actor, 'Belum ada bukti modelnya bermasalah')

    expect((await previewRelease()).changes.rules).toBe(0)
    await publishRelease({ title: 'x', actorId: actor.id })

    // The bot is exactly where it started.
    expect((await getRuntimeRuleConfig()).rules[EDITABLE_KEY].enabled).toBe(true)
  })

  it('publishes a config change on a rule that may be reconfigured but not switched off', async () => {
    const key = 'channel.unofficial_outbound_default'
    await saveRuleDraft(key, { enabled: true, config: { liveDefaultChannel: 'OFFICIAL' }, reason: REASON }, actor)
    await transitionRule(key, 'REVIEW', actor, null)
    await transitionRule(key, 'APPROVE', actor, null)
    await publishRelease({ title: 'x', actorId: actor.id })

    const rule = (await getRuntimeRuleConfig()).rules[key]
    expect(rule.config).toEqual({ liveDefaultChannel: 'OFFICIAL' })
    // A config-only draft leaves draftEnabled null; reading that as `false` would silently
    // switch off a CRITICAL channel rule.
    expect(rule.enabled).toBe(true)
  })

  it('refuses the whole way through for a rule the registry locked', async () => {
    await expect(
      saveRuleDraft('bot.no_invented_price', { enabled: false, reason: REASON }, actor)
    ).rejects.toThrow()
    expect(store.rules.get('bot.no_invented_price')?.status).toBe('PUBLISHED')
  })

  it('leaves an audit trail covering every step', async () => {
    const before = store.audits.length
    await saveRuleDraft(EDITABLE_KEY, { enabled: false, reason: REASON }, actor)
    await transitionRule(EDITABLE_KEY, 'REVIEW', actor, null)
    await transitionRule(EDITABLE_KEY, 'APPROVE', actor, null)
    await publishRelease({ title: 'x', actorId: actor.id })

    const actions = store.audits.slice(before).map((row) => row.action)
    expect(actions).toEqual(['CREATE_DRAFT', 'REQUEST_REVIEW', 'APPROVE', 'PUBLISH', 'PUBLISH'])
    // Two PUBLISH rows: one for the rule, one for the release itself.
    const ruleEntities = store.audits.slice(before).map((row) => row.entityType)
    expect(ruleEntities).toEqual(['RULE', 'RULE', 'RULE', 'RULE', 'RELEASE'])
  })
})

/**
 * @vitest-environment node
 *
 * The whole managed-knowledge lifecycle, end to end: create → draft → activate → runtime.
 *
 * The unit tests around this each mock the step before them, so none of them can catch the
 * failure that actually matters: a break in the JOIN between the workflow that writes a
 * revision and the loader the bot reads it with. A publish that writes `status = 'LIVE'` while
 * `managed-knowledge.ts` looks for `'PUBLISHED'` passes every unit test in this directory and
 * ships a bot that never learned the fact somebody just typed.
 *
 * So this drives the real functions against a small in-memory store rather than a per-call
 * mock. The store is deliberately dumb: it only has to be consistent between steps, which is
 * precisely the property being tested.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'

type Row = Record<string, unknown>

const store = {
  sources: [] as Row[],
  revisions: [] as Row[],
  audits: [] as Row[],
}

/** Set by a test that wants the database read to fail, so fail-open can be exercised. */
let revisionReadError: Error | null = null

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true
  return Object.entries(where).every(([field, expected]) => {
    // The one relation filter the loader uses: `knowledgeSource: { status: { not: 'ARCHIVED' } }`.
    if (field === 'knowledgeSource') {
      const source = store.sources.find((s) => s.id === row.knowledgeSourceId)
      const cond = (expected as Row).status as { not?: string }
      return source?.status !== cond.not
    }
    if (expected !== null && typeof expected === 'object' && 'in' in (expected as Row)) {
      return ((expected as Row).in as unknown[]).includes(row[field])
    }
    return row[field] === expected
  })
}

/** Prisma writes `Prisma.DbNull` into Json columns; reads come back as plain null. */
function normalise(data: Row): Row {
  const out: Row = {}
  for (const [field, value] of Object.entries(data)) out[field] = value === Prisma.DbNull ? null : value
  return out
}

/** Shapes a revision the way the loader's `select` does, joining its source. */
function withSource(row: Row): Row {
  const source = store.sources.find((s) => s.id === row.knowledgeSourceId)
  return { ...row, knowledgeSource: { key: source?.key, status: source?.status } }
}

const db = {
  knowledgeSource: {
    findUnique: async ({ where }: { where: { id: string } }) => store.sources.find((s) => s.id === where.id) ?? null,
    create: async ({ data }: { data: Row }) => {
      const row = normalise({ id: `ks_${store.sources.length + 1}`, ...data })
      store.sources.push(row)
      return row
    },
    update: async ({ where, data }: { where: { id: string }; data: Row }) => {
      const row = store.sources.find((s) => s.id === where.id)
      if (row) Object.assign(row, normalise(data))
      return row ?? {}
    },
  },
  knowledgeRevision: {
    findFirst: async (args?: { where?: Row; orderBy?: Row }) => {
      const rows = store.revisions.filter((row) => matches(row, args?.where))
      return [...rows].sort((a, b) => (b.version as number) - (a.version as number))[0] ?? null
    },
    findMany: async (args?: { where?: Row }) => {
      if (revisionReadError) throw revisionReadError
      return store.revisions.filter((row) => matches(row, args?.where)).map(withSource)
    },
    create: async ({ data }: { data: Row }) => {
      const row = normalise({ id: `krev_${store.revisions.length + 1}`, ...data })
      store.revisions.push(row)
      return row
    },
    update: async ({ where, data }: { where: { id: string }; data: Row }) => {
      const row = store.revisions.find((r) => r.id === where.id)
      if (row) Object.assign(row, normalise(data))
      return row ?? {}
    },
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      let count = 0
      for (const row of store.revisions) {
        if (!matches(row, where)) continue
        Object.assign(row, normalise(data))
        count += 1
      }
      return { count }
    },
  },
  botControlAuditLog: {
    create: async ({ data }: { data: Row }) => {
      const row = { id: `audit_${store.audits.length + 1}`, ...data }
      store.audits.push(row)
      return row
    },
  },
  // The workflow never branches on the transaction client's identity, so handing it the same
  // object is faithful here — atomicity itself is asserted in knowledge-workflow.test.ts.
  $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
}

vi.mock('@/lib/db', () => ({ prisma: db }))

const { createManagedKnowledge, saveKnowledgeDraft, publishKnowledgeRevision, archiveKnowledgeSource } = await import(
  './knowledge-workflow'
)
const { loadPublishedManagedKnowledge, invalidateManagedKnowledgeCache } = await import('@/lib/bot/managed-knowledge')

const actor = { id: 'acc_admin', name: 'Admin Satu' }
const REASON = 'Menutup knowledge gap harga ATV'

function body(answer: string) {
  return { items: [{ question: 'Berapa harga ATV?', answer }] }
}

/** What the bot would actually be given, for this source, right now. */
async function runtimeAnswers(): Promise<string[]> {
  invalidateManagedKnowledgeCache()
  const loaded = await loadPublishedManagedKnowledge()
  return loaded.entries.flatMap((entry) => entry.items.map((item) => item.answer))
}

beforeEach(() => {
  store.sources.length = 0
  store.revisions.length = 0
  store.audits.length = 0
  revisionReadError = null
  invalidateManagedKnowledgeCache()
})

describe('managed knowledge lifecycle', () => {
  it('keeps a saved draft away from the bot, and lets Aktifkan through', async () => {
    const created = await createManagedKnowledge(
      { title: 'FAQ Harga ATV', body: body('Rp350.000 per jam.'), reason: REASON },
      actor
    )

    // Step 1: written down. The bot must not have it — this is the promise the draft button
    // makes, and the reason an operator is willing to type a half-finished answer at all.
    expect(await runtimeAnswers()).toEqual([])
    expect(store.sources[0].status).toBe('DRAFT')

    // Step 2: activated. Now, and only now, does the bot see it.
    await publishKnowledgeRevision(created.sourceId, actor, null)
    expect(await runtimeAnswers()).toEqual(['Rp350.000 per jam.'])
    expect(store.sources[0].status).toBe('PUBLISHED')
  })

  it('takes effect without waiting out the cache, because activating drops it', async () => {
    // The cache is 30 seconds. Without the invalidation inside publishKnowledgeRevision, an
    // operator watching the screen sees no change and publishes again.
    const created = await createManagedKnowledge({ title: 'FAQ', body: body('Jawaban satu.'), reason: REASON }, actor)
    await publishKnowledgeRevision(created.sourceId, actor, null)
    await loadPublishedManagedKnowledge()

    await saveKnowledgeDraft(created.sourceId, { body: body('Jawaban dua.'), reason: REASON }, actor)
    await publishKnowledgeRevision(created.sourceId, actor, null)

    // NOT invalidated by the test: the workflow already did it.
    const loaded = await loadPublishedManagedKnowledge()
    expect(loaded.entries.flatMap((e) => e.items.map((i) => i.answer))).toEqual(['Jawaban dua.'])
  })

  it('never edits a published revision — a change becomes v2, and v1 stays as it was', async () => {
    const created = await createManagedKnowledge({ title: 'FAQ', body: body('Harga lama.'), reason: REASON }, actor)
    await publishKnowledgeRevision(created.sourceId, actor, null)

    const saved = await saveKnowledgeDraft(created.sourceId, { body: body('Harga baru.'), reason: REASON }, actor)
    expect(saved.version).toBe(2)
    expect(saved.status).toBe('DRAFT')

    // v1 is untouched and still the one answering: a draft changes nothing until it is
    // activated, which is exactly what makes the history worth reading later.
    const v1 = store.revisions.find((r) => r.version === 1)
    expect(v1?.status).toBe('PUBLISHED')
    expect(v1?.body).toEqual(body('Harga lama.'))
    expect(await runtimeAnswers()).toEqual(['Harga lama.'])

    // Activating v2 supersedes v1 rather than deleting it, so "what did the bot say in August"
    // still has an answer — and the bot is handed ONE answer, not both.
    await publishKnowledgeRevision(created.sourceId, actor, null)
    expect(store.revisions.find((r) => r.version === 1)?.status).toBe('ARCHIVED')
    expect(store.revisions.find((r) => r.version === 1)?.body).toEqual(body('Harga lama.'))
    expect(await runtimeAnswers()).toEqual(['Harga baru.'])
  })

  it('never touches a KnowledgeSource that is not MANUAL', async () => {
    // CLAUDE.md, Larangan Mutlak: nothing may overwrite a MANUAL source. The catalog mirror
    // that used to occupy this table is gone, so no writer of foreign rows exists today — this
    // test pins the guard from the other side, that every mutation here refuses a row it did
    // not create, so reintroducing such a writer fails loudly instead of eating a paragraph.
    store.sources.push({
      id: 'ks_catalog',
      key: 'imported/policy-cards',
      title: 'Policy Cards',
      type: 'IMPORTED',
      status: 'PUBLISHED',
      summary: null,
    })
    store.revisions.push({
      id: 'krev_catalog',
      knowledgeSourceId: 'ks_catalog',
      version: 1,
      title: 'Policy Cards',
      body: body('Tidak boleh dari sini.'),
      summary: null,
      status: 'DRAFT',
    })
    const before = { ...store.sources[0] }

    await expect(saveKnowledgeDraft('ks_catalog', { body: body('x'), reason: REASON }, actor)).rejects.toThrow()
    await expect(publishKnowledgeRevision('ks_catalog', actor, null)).rejects.toThrow()
    await expect(archiveKnowledgeSource('ks_catalog', 'Sudah tidak berlaku lagi', actor)).rejects.toThrow()

    expect(store.sources[0]).toEqual(before)
    expect(store.revisions[0].status).toBe('DRAFT')

    // And everything this module DOES create is MANUAL, which is what the guard keys on.
    await createManagedKnowledge({ title: 'FAQ', body: body('Boleh.'), reason: REASON }, actor)
    expect(store.sources[1].type).toBe('MANUAL')
  })

  it('stops feeding an archived source to the bot without deleting its history', async () => {
    const created = await createManagedKnowledge({ title: 'FAQ', body: body('Paket lama.'), reason: REASON }, actor)
    await publishKnowledgeRevision(created.sourceId, actor, null)
    expect(await runtimeAnswers()).toEqual(['Paket lama.'])

    await archiveKnowledgeSource(created.sourceId, 'Sudah digantikan paket baru', actor)

    expect(await runtimeAnswers()).toEqual([])
    // The revision itself stays PUBLISHED and readable — archiving answers "stop using this",
    // not "pretend it never existed".
    expect(store.revisions[0].status).toBe('PUBLISHED')
  })

  it('fails open when the database is unreadable, instead of ending a customer turn', async () => {
    // The bot has always run on the catalog alone. Losing the managed additions degrades an
    // answer; throwing would end the conversation mid-sentence.
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const created = await createManagedKnowledge({ title: 'FAQ', body: body('Ada.'), reason: REASON }, actor)
    await publishKnowledgeRevision(created.sourceId, actor, null)

    revisionReadError = new Error('db down')
    invalidateManagedKnowledgeCache()

    const loaded = await loadPublishedManagedKnowledge()
    expect(loaded.entries).toEqual([])
    expect(loaded.available).toBe(false)
  })
})

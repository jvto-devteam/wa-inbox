import { describe, it, expect, vi } from 'vitest'
// Fix round 1 (R99), Minor 5e: intercepts the DYNAMIC `await import('dotenv')` inside `main()`
// the same as a static import would -- if merely importing seed-faq-knowledge.ts's exports (as
// every test in this file does) had the side effect of loading `.env`, `config` would already
// have been called by the time the test below runs.
const dotenvConfig = vi.fn()
vi.mock('dotenv', () => ({ config: dotenvConfig }))
import {
  parseArgs,
  runSeed,
  publishBlockReason,
  printPlan,
  printPartialFailure,
  SeedUsageError,
  SeedPartialFailureError,
  type SeedDeps,
  type SeedOptions,
  type ManualSourceLookup,
} from './seed-faq-knowledge'
import type { FaqSeedEntry } from '@/lib/bot-control/faq-seed-data'
import type { RevisionResult } from '@/lib/bot-control/knowledge-workflow'

// A small fixture, not the real 11-entry FAQ_SEED_DATA -- this file exercises the script's OWN
// logic (idempotency, actor validation, dry-run, publish, conflict detection), not the seed
// content itself (covered separately by faq-seed-data.test.ts and runtime-integration.test.ts's
// routing test).
const ENTRIES: FaqSeedEntry[] = [
  { title: 'GENERAL', question: 'Are your tours private?', answer: '- All tours are private.', topics: ['general'] },
  { title: 'PAYMENT', question: 'How much is the deposit?', answer: '- Deposit: 20%.', topics: ['payment'] },
]

const ACTOR = { id: 'acc_1', name: 'Operator', role: 'ADMIN' as const }
const SEED_REASON = 'Seed FAQ knowledge dari blok GENERAL_FAQ_FALLBACK (Task 11, Ruling R57/R94).'

function revisionResult(sourceId: string, overrides: Partial<RevisionResult> = {}): RevisionResult {
  return { sourceId, revisionId: `${sourceId}-rev1`, version: 1, status: 'DRAFT', title: 'x', ...overrides }
}

/** A deps fake with no pre-existing sources and working create/publish stubs. */
function fakeDeps(overrides: Partial<SeedDeps> = {}): SeedDeps {
  return {
    findAccount: vi.fn(async (id: string) => (id === ACTOR.id ? ACTOR : null)),
    findManualSourceByTitle: vi.fn(async () => null),
    createManagedKnowledge: vi.fn(async (params) => revisionResult(`src_${params.title}`, { title: params.title })),
    publishKnowledgeRevision: vi.fn(async (sourceId: string) => revisionResult(sourceId, { status: 'PUBLISHED' })),
    ...overrides,
  }
}

function options(overrides: Partial<SeedOptions> = {}): SeedOptions {
  return { actorId: ACTOR.id, publish: false, dryRun: false, ...overrides }
}

/** A ManualSourceLookup for a source this script itself created earlier, still a fresh draft. */
function seededDraftLookup(overrides: Partial<ManualSourceLookup> = {}): ManualSourceLookup {
  return {
    id: 'src_seeded',
    status: 'DRAFT',
    createdBy: ACTOR.id,
    firstRevisionChangeReason: SEED_REASON,
    latestRevision: { status: 'DRAFT', changeReason: SEED_REASON },
    ...overrides,
  }
}

describe('parseArgs', () => {
  it('extracts --actor, --publish, and --dry-run', () => {
    expect(parseArgs(['--actor', 'acc_1', '--publish', '--dry-run'])).toEqual({
      actorId: 'acc_1',
      publish: true,
      dryRun: true,
    })
  })

  it('defaults publish/dryRun to false and actorId to undefined when absent', () => {
    expect(parseArgs([])).toEqual({ actorId: undefined, publish: false, dryRun: false })
  })

  it('does not require --actor and --publish/--dry-run in any particular order', () => {
    expect(parseArgs(['--dry-run', '--actor', 'acc_9'])).toEqual({ actorId: 'acc_9', publish: false, dryRun: true })
  })
})

describe('runSeed — actor requirement', () => {
  it('throws SeedUsageError when --actor is missing', async () => {
    const deps = fakeDeps()
    await expect(runSeed(ENTRIES, options({ actorId: undefined }), deps)).rejects.toThrow(SeedUsageError)
    expect(deps.findAccount).not.toHaveBeenCalled()
  })

  it('throws SeedUsageError when the account does not exist', async () => {
    const deps = fakeDeps({ findAccount: vi.fn(async () => null) })
    await expect(runSeed(ENTRIES, options({ actorId: 'ghost' }), deps)).rejects.toThrow(SeedUsageError)
    expect(deps.createManagedKnowledge).not.toHaveBeenCalled()
  })

  // Fix round 1 (R99), Minor 5d: same authorization rule as the UI (CLAUDE.md §6 -- every
  // mutation goes through `hasAdminPowers`, no separate permission matrix for scripts).
  it('throws SeedUsageError when the account exists but is only an AGENT', async () => {
    const deps = fakeDeps({ findAccount: vi.fn(async () => ({ id: ACTOR.id, name: 'Some Agent', role: 'AGENT' as const })) })
    await expect(runSeed(ENTRIES, options(), deps)).rejects.toThrow(SeedUsageError)
    expect(deps.createManagedKnowledge).not.toHaveBeenCalled()
  })

  it('allows an OWNER account (also hasAdminPowers), not just ADMIN', async () => {
    const deps = fakeDeps({ findAccount: vi.fn(async () => ({ id: ACTOR.id, name: 'Owner', role: 'OWNER' as const })) })
    const result = await runSeed(ENTRIES, options(), deps)
    expect(result.created).toEqual(['GENERAL', 'PAYMENT'])
  })
})

describe('runSeed — default mode (write DRAFT)', () => {
  it('creates a DRAFT for every entry via createManagedKnowledge, with question/answer/topics carried through verbatim', async () => {
    const deps = fakeDeps()

    const result = await runSeed(ENTRIES, options(), deps)

    expect(deps.createManagedKnowledge).toHaveBeenCalledTimes(2)
    expect(deps.createManagedKnowledge).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'GENERAL',
        body: { items: [{ question: 'Are your tours private?', answer: '- All tours are private.', topics: ['general'] }] },
      }),
      { id: ACTOR.id, name: ACTOR.name }
    )
    expect(result.created).toEqual(['GENERAL', 'PAYMENT'])
    expect(result.skipped).toEqual([])
    expect(result.blocked).toEqual([])
  })

  it('is idempotent: a title whose source THIS SCRIPT created is skipped, not recreated', async () => {
    const deps = fakeDeps({
      findManualSourceByTitle: vi.fn(async (title: string) => (title === 'GENERAL' ? seededDraftLookup() : null)),
    })

    const result = await runSeed(ENTRIES, options(), deps)

    expect(deps.createManagedKnowledge).toHaveBeenCalledTimes(1)
    expect(deps.createManagedKnowledge).toHaveBeenCalledWith(expect.objectContaining({ title: 'PAYMENT' }), expect.anything())
    expect(result.created).toEqual(['PAYMENT'])
    expect(result.skipped).toEqual(['GENERAL'])
    expect(result.blocked).toEqual([])
  })

  it('never calls publishKnowledgeRevision when --publish is not passed', async () => {
    const deps = fakeDeps()
    await runSeed(ENTRIES, options({ publish: false }), deps)
    expect(deps.publishKnowledgeRevision).not.toHaveBeenCalled()
  })
})

// Fix round 1 (R99), Important 1: a title match alone must never be treated as "already
// seeded" -- only a source whose FIRST revision carries this script's own SEED_REASON is ours.
describe('runSeed — conflict detection (Important 1)', () => {
  it('an operator MANUAL source with the same title is reported as blocked, never created over, never published', async () => {
    const deps = fakeDeps({
      findManualSourceByTitle: vi.fn(async (title: string) =>
        title === 'GENERAL'
          ? {
              id: 'src_operator',
              status: 'DRAFT',
              createdBy: 'acc_operator',
              firstRevisionChangeReason: 'Menulis FAQ deposit dari operator langsung.',
              latestRevision: { status: 'DRAFT', changeReason: 'Menulis FAQ deposit dari operator langsung.' },
            }
          : null
      ),
    })

    const result = await runSeed(ENTRIES, options({ publish: true }), deps)

    expect(deps.createManagedKnowledge).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'GENERAL' }), expect.anything())
    expect(deps.publishKnowledgeRevision).not.toHaveBeenCalledWith('src_operator', expect.anything(), expect.anything())
    expect(result.blocked).toEqual([
      {
        title: 'GENERAL',
        reason: expect.stringContaining('BUKAN dibuat oleh seed ini'),
      },
    ])
    expect(result.created).toEqual(['PAYMENT'])
    expect(result.skipped).toEqual([])
    expect(result.published).not.toContain('GENERAL')
  })

  it('the blocked reason names the actual createdBy, for operator diagnosis', async () => {
    const deps = fakeDeps({
      findManualSourceByTitle: vi.fn(async (title: string) =>
        title === 'GENERAL'
          ? { id: 'src_operator', status: 'DRAFT', createdBy: 'acc_jane', firstRevisionChangeReason: 'x', latestRevision: null }
          : null
      ),
    })
    const result = await runSeed(ENTRIES, options(), deps)
    expect(result.blocked[0].reason).toContain('acc_jane')
  })

  it('an operator v2 draft written on top of a SEED-created source is not published, but is not a create-time conflict either', async () => {
    const deps = fakeDeps({
      findManualSourceByTitle: vi.fn(async (title: string) =>
        title === 'GENERAL'
          ? seededDraftLookup({
              // First revision (v1) is still ours -- so this is NOT a create-time conflict --
              // but the LATEST revision is the operator's own v2 edit, not ours.
              latestRevision: { status: 'DRAFT', changeReason: "Operator's own edit, v2." },
            })
          : null
      ),
    })

    const result = await runSeed(ENTRIES, options({ publish: true }), deps)

    expect(result.blocked).toEqual([]) // create-time: this source genuinely is ours (v1 matches).
    expect(result.skipped).toEqual(['GENERAL']) // idempotent skip at create time, as normal.
    expect(deps.publishKnowledgeRevision).not.toHaveBeenCalledWith('src_seeded', expect.anything(), expect.anything())
    expect(result.published).not.toContain('GENERAL')
    expect(result.publishSkipped).toEqual([
      { title: 'GENERAL', reason: expect.stringContaining('bukan ditulis oleh seed ini') },
    ])
  })

  it('a normal seeded draft (untouched since this script wrote it) DOES get published', async () => {
    const deps = fakeDeps({
      findManualSourceByTitle: vi.fn(async (title: string) => (title === 'GENERAL' ? seededDraftLookup() : null)),
    })

    const result = await runSeed(ENTRIES, options({ publish: true }), deps)

    expect(deps.publishKnowledgeRevision).toHaveBeenCalledWith('src_seeded', { id: ACTOR.id, name: ACTOR.name }, SEED_REASON)
    expect(result.published).toContain('GENERAL')
    expect(result.publishSkipped.find((p) => p.title === 'GENERAL')).toBeUndefined()
  })

  // Minor 5b: an ARCHIVED source is a distinct, explicit blocking case -- even if it WAS
  // originally created by this script, archiving means "stop using this" and must not be
  // silently treated as "already seeded, fine to publish/skip".
  it('an ARCHIVED source with the same title is reported explicitly as blocked, not silently skipped', async () => {
    const deps = fakeDeps({
      findManualSourceByTitle: vi.fn(async (title: string) =>
        title === 'GENERAL' ? seededDraftLookup({ status: 'ARCHIVED' }) : null
      ),
    })

    const result = await runSeed(ENTRIES, options({ publish: true }), deps)

    expect(result.blocked).toEqual([{ title: 'GENERAL', reason: expect.stringContaining('diarsipkan') }])
    expect(result.skipped).toEqual([])
    expect(deps.publishKnowledgeRevision).not.toHaveBeenCalledWith('src_seeded', expect.anything(), expect.anything())
    expect(result.published).not.toContain('GENERAL')
  })
})

describe('publishBlockReason', () => {
  it('returns null (publishable) for a fresh SEED_REASON draft', () => {
    expect(publishBlockReason({ status: 'DRAFT', changeReason: SEED_REASON })).toBeNull()
  })

  it('blocks an already-PUBLISHED revision', () => {
    expect(publishBlockReason({ status: 'PUBLISHED', changeReason: SEED_REASON })).toContain('PUBLISHED')
  })

  it('blocks a draft whose changeReason is not the seed\'s own', () => {
    expect(publishBlockReason({ status: 'DRAFT', changeReason: 'operator edit' })).toContain('bukan ditulis oleh seed ini')
  })

  it('blocks when there is no revision at all', () => {
    expect(publishBlockReason(null)).toContain('belum punya revisi')
  })
})

describe('runSeed — --publish', () => {
  it('publishes the (freshly created) source of every entry', async () => {
    const deps = fakeDeps()

    const result = await runSeed(ENTRIES, options({ publish: true }), deps)

    expect(deps.publishKnowledgeRevision).toHaveBeenCalledTimes(2)
    expect(deps.publishKnowledgeRevision).toHaveBeenCalledWith('src_GENERAL', expect.anything(), SEED_REASON)
    expect(deps.publishKnowledgeRevision).toHaveBeenCalledWith('src_PAYMENT', expect.anything(), SEED_REASON)
    expect(result.published).toEqual(['GENERAL', 'PAYMENT'])
  })

  it('records a publish failure (thrown by publishKnowledgeRevision) as publishSkipped instead of throwing', async () => {
    const deps = fakeDeps({
      publishKnowledgeRevision: vi.fn(async (sourceId: string) => {
        if (sourceId === 'src_GENERAL') throw new Error('Revisi v1 berstatus PUBLISHED; tidak ada draft untuk diaktifkan.')
        return revisionResult(sourceId, { status: 'PUBLISHED' })
      }),
    })

    const result = await runSeed(ENTRIES, options({ publish: true }), deps)

    expect(result.published).toEqual(['PAYMENT'])
    expect(result.publishSkipped).toEqual([
      { title: 'GENERAL', reason: 'Revisi v1 berstatus PUBLISHED; tidak ada draft untuk diaktifkan.' },
    ])
  })
})

describe('runSeed — --dry-run', () => {
  it('writes nothing: never calls createManagedKnowledge or publishKnowledgeRevision', async () => {
    const deps = fakeDeps()

    const result = await runSeed(ENTRIES, options({ dryRun: true, publish: true }), deps)

    expect(deps.createManagedKnowledge).not.toHaveBeenCalled()
    expect(deps.publishKnowledgeRevision).not.toHaveBeenCalled()
    // Still reports the plan it WOULD have executed.
    expect(result.created).toEqual(['GENERAL', 'PAYMENT'])
    expect(result.published).toEqual(['GENERAL', 'PAYMENT'])
  })

  it('still reports pre-existing sources as skipped (a real, read-only lookup)', async () => {
    const deps = fakeDeps({
      findManualSourceByTitle: vi.fn(async (title: string) => (title === 'GENERAL' ? seededDraftLookup() : null)),
    })

    const result = await runSeed(ENTRIES, options({ dryRun: true }), deps)

    expect(result.skipped).toEqual(['GENERAL'])
    expect(result.created).toEqual(['PAYMENT'])
    expect(deps.createManagedKnowledge).not.toHaveBeenCalled()
  })

  it('still validates the actor (a read-only lookup), even in dry-run', async () => {
    const deps = fakeDeps({ findAccount: vi.fn(async () => null) })
    await expect(runSeed(ENTRIES, options({ dryRun: true, actorId: 'ghost' }), deps)).rejects.toThrow(SeedUsageError)
  })

  // Minor 5a: an accurate preview must not claim an already-published entry "would" be
  // published again -- it never touches `publishKnowledgeRevision` in dry-run, but the PREVIEW
  // itself must reflect reality.
  it('--dry-run --publish skips an already-published entry in the preview, not just in a real run', async () => {
    const deps = fakeDeps({
      findManualSourceByTitle: vi.fn(async (title: string) =>
        title === 'GENERAL'
          ? seededDraftLookup({ latestRevision: { status: 'PUBLISHED', changeReason: SEED_REASON } })
          : null
      ),
    })

    const result = await runSeed(ENTRIES, options({ dryRun: true, publish: true }), deps)

    expect(result.published).toEqual(['PAYMENT'])
    expect(result.publishSkipped.find((p) => p.title === 'GENERAL')?.reason).toContain('PUBLISHED')
  })

  it('--dry-run --publish also reflects a blocked (not-ours) entry in the preview -- never listed as would-publish', async () => {
    const deps = fakeDeps({
      findManualSourceByTitle: vi.fn(async (title: string) =>
        title === 'GENERAL'
          ? { id: 'src_operator', status: 'DRAFT', createdBy: 'acc_jane', firstRevisionChangeReason: 'x', latestRevision: null }
          : null
      ),
    })

    const result = await runSeed(ENTRIES, options({ dryRun: true, publish: true }), deps)

    expect(result.blocked.map((b) => b.title)).toEqual(['GENERAL'])
    expect(result.published).not.toContain('GENERAL')
  })
})

// Minor 5c: a mid-run create failure must not lose track of what had already succeeded.
describe('runSeed — partial failure (Minor 5c)', () => {
  it('rejects with SeedPartialFailureError carrying everything created before the failure', async () => {
    const deps = fakeDeps({
      createManagedKnowledge: vi.fn(async (params) => {
        if (params.title === 'PAYMENT') throw new Error('db kicked us out')
        return revisionResult(`src_${params.title}`, { title: params.title })
      }),
    })

    const error = await runSeed(ENTRIES, options(), deps).catch((e) => e)

    expect(error).toBeInstanceOf(SeedPartialFailureError)
    expect((error as InstanceType<typeof SeedPartialFailureError>).partial.created).toEqual(['GENERAL'])
    expect((error as Error).message).toContain('PAYMENT')
    expect((error as Error).message).toContain('db kicked us out')
  })

  it('printPartialFailure reports the message and what was already created', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const error = new SeedPartialFailureError('Gagal membuat "PAYMENT": db kicked us out', {
      created: ['GENERAL'],
      skipped: [],
      blocked: [],
      published: [],
      publishSkipped: [],
    })

    printPartialFailure(error)

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Gagal membuat "PAYMENT"'))
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('GENERAL'))
    logSpy.mockRestore()
    errorSpy.mockRestore()
  })
})

describe('printPlan', () => {
  it('lists blocked entries with their reasons', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    printPlan(
      { created: [], skipped: [], blocked: [{ title: 'GENERAL', reason: 'sudah diarsipkan' }], published: [], publishSkipped: [] },
      options()
    )
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Diblokir'))
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('GENERAL: sudah diarsipkan'))
    logSpy.mockRestore()
  })
})

// Minor 5e: importing this module (as every test above does) must never read `.env` as a side
// effect -- only `main()`, behind the `require.main === module` guard, does that.
describe('module import side effects (Minor 5e)', () => {
  it('does not call dotenv config() merely by being imported', async () => {
    // Every test above already imported this module's exports (`runSeed`, `parseArgs`, etc.) --
    // if `config()` ran at module load time (the pre-fix behaviour), it would already have been
    // called by now. `main()` is the only place that imports/calls it, and `main()` never runs
    // outside the `require.main === module` guard, which is false under vitest.
    expect(dotenvConfig).not.toHaveBeenCalled()
  })
})

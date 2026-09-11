import { describe, it, expect, vi } from 'vitest'
import { parseArgs, runSeed, SeedUsageError, type SeedDeps, type SeedOptions } from './seed-faq-knowledge'
import type { FaqSeedEntry } from '@/lib/bot-control/faq-seed-data'
import type { RevisionResult } from '@/lib/bot-control/knowledge-workflow'

// A small fixture, not the real 11-entry FAQ_SEED_DATA -- this file exercises the script's OWN
// logic (idempotency, actor validation, dry-run, publish), not the seed content itself (covered
// separately by faq-seed-data.test.ts and runtime-integration.test.ts's routing test).
const ENTRIES: FaqSeedEntry[] = [
  { title: 'GENERAL', question: 'Are your tours private?', answer: '- All tours are private.', topics: ['general'] },
  { title: 'PAYMENT', question: 'How much is the deposit?', answer: '- Deposit: 20%.', topics: ['payment'] },
]

const ACTOR = { id: 'acc_1', name: 'Operator' }

function revisionResult(sourceId: string, overrides: Partial<RevisionResult> = {}): RevisionResult {
  return { sourceId, revisionId: `${sourceId}-rev1`, version: 1, status: 'DRAFT', title: 'x', ...overrides }
}

/** A deps fake with no pre-existing sources and working create/publish stubs. */
function fakeDeps(overrides: Partial<SeedDeps> = {}): SeedDeps {
  return {
    findAccount: vi.fn(async (id: string) => (id === ACTOR.id ? ACTOR : null)),
    findManualSourceByTitle: vi.fn(async () => null),
    createManagedKnowledge: vi.fn(async (params) => revisionResult(`src_${params.title}`, { title: params.title })),
    publishKnowledgeRevision: vi.fn(async (sourceId) => revisionResult(sourceId, { status: 'PUBLISHED' })),
    ...overrides,
  }
}

function options(overrides: Partial<SeedOptions> = {}): SeedOptions {
  return { actorId: ACTOR.id, publish: false, dryRun: false, ...overrides }
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
      ACTOR
    )
    expect(result.created).toEqual(['GENERAL', 'PAYMENT'])
    expect(result.skipped).toEqual([])
  })

  it('is idempotent: a title whose MANUAL source already exists is skipped, not recreated', async () => {
    const deps = fakeDeps({
      findManualSourceByTitle: vi.fn(async (title: string) => (title === 'GENERAL' ? { id: 'src_existing_general' } : null)),
    })

    const result = await runSeed(ENTRIES, options(), deps)

    expect(deps.createManagedKnowledge).toHaveBeenCalledTimes(1)
    expect(deps.createManagedKnowledge).toHaveBeenCalledWith(expect.objectContaining({ title: 'PAYMENT' }), ACTOR)
    expect(result.created).toEqual(['PAYMENT'])
    expect(result.skipped).toEqual(['GENERAL'])
  })

  it('never calls publishKnowledgeRevision when --publish is not passed', async () => {
    const deps = fakeDeps()
    await runSeed(ENTRIES, options({ publish: false }), deps)
    expect(deps.publishKnowledgeRevision).not.toHaveBeenCalled()
  })
})

describe('runSeed — --publish', () => {
  it('publishes the (freshly created) source of every entry', async () => {
    const deps = fakeDeps()

    const result = await runSeed(ENTRIES, options({ publish: true }), deps)

    expect(deps.publishKnowledgeRevision).toHaveBeenCalledTimes(2)
    expect(deps.publishKnowledgeRevision).toHaveBeenCalledWith('src_GENERAL', ACTOR, expect.any(String))
    expect(deps.publishKnowledgeRevision).toHaveBeenCalledWith('src_PAYMENT', ACTOR, expect.any(String))
    expect(result.published).toEqual(['GENERAL', 'PAYMENT'])
  })

  it('publishes an already-existing (skipped-at-create) source too, using its found sourceId', async () => {
    const deps = fakeDeps({
      findManualSourceByTitle: vi.fn(async (title: string) => (title === 'GENERAL' ? { id: 'src_existing' } : null)),
    })

    const result = await runSeed(ENTRIES, options({ publish: true }), deps)

    expect(deps.publishKnowledgeRevision).toHaveBeenCalledWith('src_existing', ACTOR, expect.any(String))
    expect(result.published).toContain('GENERAL')
  })

  it('records a publish failure (e.g. already published, no draft) as publishSkipped instead of throwing', async () => {
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
      findManualSourceByTitle: vi.fn(async (title: string) => (title === 'GENERAL' ? { id: 'src_existing' } : null)),
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
})

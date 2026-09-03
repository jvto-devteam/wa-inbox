/**
 * Regression suite against the REAL parsing/classification pipeline -- the gap orchestrator.test.ts
 * structurally cannot cover. That file mocks matchDestination/extractTripPreferences/
 * classifyTopicViaLLM/resolveKnowledgeForTopic themselves, so the real regex/keyword logic inside
 * package-match.ts,
 * module-resolver.ts, knowledge.ts, sales-classifier.ts, and scenario-evaluator.ts never actually
 * runs there -- exactly why 4+ real parsing bugs (finish-context word order, "instead of" false
 * suppression, funnel-swallows-unrelated-topic, etc.) all had to be found by live-testing in the
 * sandbox AFTER deploy, not by the 1200+ existing unit tests.
 *
 * This file mocks ONLY the true I/O boundaries (DB, LLM, the external Booking API) plus two
 * operator-controlled policy gates (deployment approval, route integrity) that are orthogonal to
 * parsing correctness and already have their own dedicated test coverage. Everything else --
 * package-match.ts, module-resolver.ts, knowledge.ts, sales-classifier.ts, scenario-evaluator.ts,
 * catalog.ts -- runs for REAL, against the real, committed `catalog/` data, exactly as production
 * does. Each scenario below is a real customer message that caused a real, reported bug this
 * session -- a permanent regression net for exactly this class of bug, not a re-test of behavior
 * orchestrator.test.ts already covers with its own (necessarily synthetic) fixtures.
 *
 * Skips itself when the real catalog isn't present, same as the other `*.real.test.ts` files.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { decideAndRespond } from './orchestrator'
import { ensureFreshBookingData } from '@/lib/booking/client'
import { checkRouteGate } from './route-gate'
import { callLLM } from './llm'
import { checkDeploymentGate } from './deployment-gate'
import type { TripBrief } from './types'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/booking/client')
vi.mock('./route-gate')
vi.mock('./llm')
vi.mock('./deployment-gate')
// Deliberately NOT mocked: package-match, module-resolver, knowledge, sales-classifier,
// scenario-evaluator, catalog -- see this file's own header for why.

const RELEASE_PRESENT = fs.existsSync(path.join(process.cwd(), 'catalog', 'general-modules.json'))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

// persistTripBrief now writes via a tagged-template `$executeRaw` call (server-side jsonb
// merge) instead of `conversation.update`, so assertions that used to inspect the update
// payload now read the raw call's interpolated patch instead: `mock.calls[i]` is
// `[templateStrings, patchJson, conversationId]` for each write.
function tripBriefWrites(): Partial<TripBrief>[] {
  return mockPrisma.$executeRaw.mock.calls.map(([, patchJson]) => JSON.parse(patchJson as string) as Partial<TripBrief>)
}

// This file deliberately leaves the six real classifiers unmocked (see the file header), so
// every decideAndRespond call fans out into several callLLM invocations, not one -- and their
// order is an implementation detail that has already changed once (they now run batched rather
// than in sequence). The reply-composing call is therefore identified by WHAT it is -- the only
// one grounded in the shared persona preamble -- rather than by its position in mock.calls.
function composerCall(): { system: string } {
  const composerCalls = (callLLM as any).mock.calls.filter(
    ([, opts]: [string, { system?: string }]) => opts?.system?.startsWith('You are a real member of the JVTO')
  )
  expect(composerCalls).toHaveLength(1)
  return composerCalls[0][1]
}

function withTripBrief(tripBrief: TripBrief) {
  mockPrisma.conversation.findUniqueOrThrow.mockResolvedValue({
    id: 'conv_1',
    tripBrief,
    bookingData: null,
    bookingCheckedAt: null,
    contact: { phone: '6281234567890' },
  } as never)
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.clearAllMocks()
  ;(ensureFreshBookingData as any).mockResolvedValue(null)
  ;(checkDeploymentGate as any).mockReturnValue({ readyForApproval: true, blocking: [] })
  ;(checkRouteGate as any).mockReturnValue({ status: 'clear' })
  ;(callLLM as any).mockResolvedValue('A real reply.')
  mockPrisma.settings.findUniqueOrThrow.mockResolvedValue({ ollamaModel: 'gemma4:31b-cloud' } as never)
  mockPrisma.message.findMany.mockResolvedValue([] as never)
  mockPrisma.conversation.update.mockResolvedValue({} as never)
  withTripBrief({})
})

describe.skipIf(!RELEASE_PRESENT)('decideAndRespond against the real parsing pipeline + real catalog', () => {
  // Reported live 2026-08-06: "finish" actually governs "bali" (the word right after it), but
  // the old suppression window also caught "surabaya" (the word right BEFORE it) purely by
  // proximity, so origin resolved to null instead of 'Surabaya'.
  it('parses "3 days start surabaya finish bali" as origin=Surabaya, finishCity=Bali, dayCount=3', async () => {
    withTripBrief({ destination: 'ijen' })

    await decideAndRespond('conv_1', '3 days start surabaya finish bali')

    const tripBriefUpdate = tripBriefWrites().find((patch) => patch.origin || patch.finishCity)
    expect(tripBriefUpdate).toMatchObject({ origin: 'Surabaya', finishCity: 'bali', dayCount: 3 })
  })

  // Reported live 2026-08-06: "picked up from Malang instead of Surabaya" -- the bare-city
  // fallback misread "...instead of Surabaya" as if Surabaya were the stated pickup point,
  // silently suppressing the real, unsupported-city origin (Malang) entirely.
  it('honestly flags Malang as an unsupported pickup city for "picked up from Malang instead of Surabaya"', async () => {
    const result = await decideAndRespond('conv_1', 'I was wondering if there is any option to get picked up from Malang instead of Surabaya?')

    // No destination mentioned -> falls through to the static (non-LLM) "where would you like
    // to go" reply, which must still carry the honest unsupported-city note.
    expect(result.mode).toBe('clarify')
    expect((result as { reply: string }).reply).toContain("We don't have pickup from Malang")
  })

  // Reported live 2026-08-06: pure Latin-script destination/keyword matching missed a real,
  // fully-answerable Chinese-language itinerary+price question entirely.
  it('recognizes Bromo and Ijen from a real Chinese-language message', async () => {
    withTripBrief({})

    await decideAndRespond('conv_1', '第二天去布罗莫,第三天伊真,这样是怎么收费哦')

    const destinationUpdate = tripBriefWrites().find((patch) => patch.destination)
    expect(destinationUpdate?.destination).toBe('bromo')
  })

  // Reported live 2026-08-06: a real customer said "blue flames" (not "blue fire") throughout
  // a whole conversation -- neither the topic classifier nor the crater-access keyword list
  // recognized this natural paraphrase.
  it('resolves the Ijen crater-access fact for "blue flames" (a real customer paraphrase of "blue fire")', async () => {
    withTripBrief({ destination: 'ijen' })

    await decideAndRespond('conv_1', 'Seeing the blue flames was the main reason we booked this tour. Is it still accessible right now?')

    // The six unmocked classifiers each call callLLM too (the blanket 'A real reply.' mock
    // isn't valid JSON for any of them, so they all fall back to their real regex/fail-safe
    // implementations) -- composerCall() picks out the reply-composing one by identity.
    const opts = composerCall()
    expect(opts.system.toLowerCase()).toContain('closed')
  })

  // Reported live 2026-08-06: this exact message classifies as topic 'price' (any "how much"
  // question does), which ALSO triggers the trip-preferences funnel gate -- the funnel's own
  // reply is a static template built BEFORE the knowledge-composition step, so the customer's
  // real, answerable questions (jacket rental, the Ijen trolley) were silently dropped.
  it('answers jacket-rental and Ijen-trolley questions inside the funnel reply itself, not just the bullet list', async () => {
    withTripBrief({ destination: 'ijen' })

    const result = await decideAndRespond('conv_1', 'How much to rent a jacket, and is there a trolley up Ijen crater?')

    expect(result.mode).toBe('clarify')
    const reply = (result as { reply: string }).reply
    expect(reply.toLowerCase()).toContain('rp35,000')
    expect(reply).toContain('Happy to recommend the best package for you!')
  })

  // Reported live 2026-08-06: "Which package do you recommend for Ijen?" -> funnel asks ->
  // "How much is the deposit?" (topic 'payment', fully answerable on its own) was getting
  // re-funneled instead of answered -- the awaitingTripPreferencesAnswer override didn't
  // exclude DESTINATION_INDEPENDENT_TOPICS.
  it('answers a genuinely unrelated question (deposit) directly on the message right after the funnel asked, instead of re-asking', async () => {
    withTripBrief({ destination: 'ijen', askedTripPreferences: true, awaitingTripPreferencesAnswer: true })

    const result = await decideAndRespond('conv_1', 'How much is the deposit?')

    expect(result.mode).toBe('faq')
    const opts = composerCall()
    expect(opts.system.toLowerCase()).toContain('deposit')
    expect(opts.system).not.toContain('Happy to recommend the best package')
  })

  // The operator's own example: a late Surabaya pickup requesting both Bromo and Ijen should
  // surface a Bromo-first recommendation with rest-time reasoning -- ported from
  // jvto-itinerary-core's real scenario evaluator (scenario-evaluator.ts).
  it('surfaces a Bromo-first, rest-time-aware recommendation for a late Surabaya pickup wanting Bromo and Ijen', async () => {
    withTripBrief({ destination: 'ijen', origin: 'Surabaya', finishCity: 'ketapang', dayCount: 3 })

    await decideAndRespond('conv_1', 'Pickup from Surabaya Airport jam 6 sore, mau ke Bromo dan Ijen.')

    const opts = composerCall()
    expect(opts.system.toLowerCase()).toMatch(/bromo.*ijen/)
    expect(opts.system.toLowerCase()).toContain('rest')
  })

  // A customer who explicitly declines to state trip preferences should be recommended a
  // package directly instead of being funneled -- the one deliberate exception to the
  // otherwise-mandatory start/finish/day-count requirement.
  it('proceeds straight to a package recommendation when the customer explicitly says they don\'t know their preferences', async () => {
    withTripBrief({ destination: 'ijen' })

    const result = await decideAndRespond('conv_1', "I'm not sure yet, what would you recommend for Ijen?")

    expect(result.mode).toBe('faq')
  })

  // Sanity check: the funnel is still mandatory for an ordinary recommendation request with no
  // preferences stated and no decline signal -- the baseline this whole file's other decline/
  // exception-case scenarios are contrasted against.
  it('still asks for start/finish/day-count on an ordinary "which package do you recommend" with nothing else stated', async () => {
    withTripBrief({ destination: 'ijen' })

    const result = await decideAndRespond('conv_1', 'Which package do you recommend for Ijen?')

    expect(result.mode).toBe('clarify')
    expect((result as { reply: string }).reply).toContain('Happy to recommend the best package for you!')
  })

  // Reported live 2026-08-07: this exact real customer message got a reply whose TEXT correctly
  // described real 4/5/6-day Surabaya round-trip packages covering Bromo+Tumpak Sewu+Ijen, but
  // whose LINK pointed to "bromo-1d1n" -- a completely different, single-destination, 1-day
  // Bromo-only package. Root cause: matchDestination narrows to a single anchor destination
  // ('bromo', mentioned first), and pickPackage (which decides the single package/link) had no
  // awareness of the OTHER destinations named, unlike narrowPackagePool (which correctly used
  // all of them for the options text). Fixed at the source in pickPackage itself (requestedTokens
  // parameter) plus broadened recommendMultiple -- verified here against the real catalog with
  // the exact real message, not a synthetic fixture.
  it('never links to a single-destination package when the customer names multiple real destinations ("bromo, tumpak sewu and ijen... return to Surabaya")', async () => {
    withTripBrief({})

    await decideAndRespond(
      'conv_1',
      'Hello. We are looking for a tour on the 13th of August from Surabaya to bromo, tumpak sewu and ijen. We want to return to Surabaya though. Is this possible with you?'
    )

    const opts = composerCall()
    expect(opts.system).not.toContain('bromo-1d1n')
    expect(opts.system.toLowerCase()).toContain('tumpak-sewu-bromo')
  })

  // Reported live 2026-08-07: no real Ijen package both starts AND finishes in Bali (all
  // Bali-origin packages drop off in Surabaya/Malang, per catalog/endpoint-chains.json). The
  // single grounding package (`pkg`, used for "Package the customer is asking about" and its
  // own policyNotes/stagingNotes/link) used to be chosen by `pickPackage` independently from
  // the options list (`packageOptionsText`, chosen by `narrowPackagePool`) -- two different
  // narrowing algorithms that could disagree: `pickPackage` filtered by finishCity first, then
  // silently DROPPED the customer's stated Bali origin when applying it to the already-narrowed
  // (Surabaya-origin) pool, presenting a Surabaya-origin package as unqualified fact right next
  // to matchTierNote's own honest disclosure that no package actually matches the stated
  // combination. `pkg` is now derived from the exact same pool the options text uses, so
  // whatever package it names is always genuinely present among the disclosed options.
  it('keeps the single grounding package consistent with the disclosed options when origin+finishCity together have no real match ("Ijen from Bali, finishing in Bali too")', async () => {
    withTripBrief({ destination: 'ijen' })

    await decideAndRespond('conv_1', 'We want a 3 day Ijen tour starting from Bali, and finishing in Bali as well.')

    const opts = composerCall()
    const pkgMatch = opts.system.match(/Package the customer is asking about: (.+)/)
    expect(pkgMatch).not.toBeNull()
    const pkgTitle = pkgMatch![1].trim()
    // Whatever single package is named, it must genuinely appear among the disclosed options
    // the customer can see in the same reply -- never a package absent from that list.
    expect(opts.system).toContain(`- ${pkgTitle}`)
  })

  // finishCity persists across turns by design (see TripBrief.finishCity's own header), but the
  // "customer asked whether the trip can finish there" sentence built from it must NOT persist
  // the same way -- a customer who named a finish city once on an earlier message shouldn't
  // still be told "you asked about finishing in Bali" ten messages later while asking about
  // breakfast. The merged finishCity still narrows the package pool; only this assertion is
  // scoped to the message that actually asked.
  it('stops asserting a finish-city question the customer only asked earlier', async () => {
    withTripBrief({ destination: 'ijen', finishCity: 'bali', origin: 'Surabaya', dayCount: 3 })

    // This message is about breakfast. finishCity is only on file from an earlier turn.
    await decideAndRespond('conv_1', 'is breakfast included every morning?')

    const system = vi.mocked(callLLM).mock.lastCall![1]!.system!
    expect(system).not.toContain('The customer asked whether the trip can finish')
  })

  it('still answers the finish-city question on the message that asks it', async () => {
    withTripBrief({ destination: 'ijen' })

    await decideAndRespond('conv_1', 'can we finish the trip in Bali?')

    const system = vi.mocked(callLLM).mock.lastCall![1]!.system!
    expect(system).toContain('The customer asked whether the trip can finish')
  })

  it('puts the real overnight hotel names in the prompt for a hotel question', async () => {
    await decideAndRespond('conv_1', 'which hotel do we stay at for the 3 day bromo ijen tour from bali?')
    const system = vi.mocked(callLLM).mock.lastCall![1]!.system!
    expect(system).toContain('Joglo Kecombrang Bromo')
    expect(system).not.toContain("that's where it's listed")
  })
})

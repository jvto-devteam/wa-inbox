/**
 * Ruling R106: the East Java region, end to end, through the REAL route gate.
 *
 * The first region fix (ca82df9) sent 'east java' down the destination branch as if it were a
 * destination. route-gate.ts matches destinations exactly against `destinationTokens`, so it
 * rejected the region and the turn answered TECHNICAL_HICCUP_REPLY. Every orchestrator test file
 * mocked the route gate, which is why removing that fix entirely left the whole suite green.
 *
 * This file therefore mocks the same true I/O boundaries as orchestrator.real.test.ts (DB, LLM,
 * the Booking API, and the operator-controlled deployment gate) but NOT route-gate.ts. Everything
 * else runs for real against the committed `catalog/`. callLLM returns a non-JSON string, so every
 * classifier, including the trip-preferences extractor, takes its regex fallback. The outcomes
 * below are those fallback outcomes.
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
import { callLLM } from './llm'
import { checkDeploymentGate } from './deployment-gate'
import { loadCatalog } from './catalog'
import { narrowPackagePool, packagesForDestination, parseTripPreferences, resolveRegionDestination } from './package-match'
import { EVAL_CASES } from './eval/fixtures'
import type { TripBrief } from './types'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/booking/client')
vi.mock('./llm')
vi.mock('./deployment-gate')
// Deliberately NOT mocked: route-gate -- see this file's own header.

const RELEASE_PRESENT = fs.existsSync(path.join(process.cwd(), 'catalog', 'general-modules.json'))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

// The live 2026-09-09 report, read from the eval fixture so the two can never drift apart.
const liveCase = EVAL_CASES.find((c) => c.id === 'east-java-region-named')
if (!liveCase) throw new Error('eval fixture east-java-region-named is missing')
const LIVE_TEXT = liveCase.turns[0]

// Recomputed from the committed catalog for the live text: parseTripPreferences gives
// origin=Surabaya, dayCount=4, finishCity=bali, which narrows all 16 packages to
// tumpak-sewu-bromo-ijen-4d3n alone. Its tokens bromo/ijen/tumpak sewu are carried by 15/13/6
// catalog packages, so the widest one, 'bromo', is chosen (resolveRegionDestination's header).
const LIVE_PACKAGE = 'tumpak-sewu-bromo-ijen-4d3n'
const LIVE_TOKEN = 'bromo'

const HICCUP = "technical hiccup"
const DESTINATION_LIST = 'Where would you like to go'

type Decision = Awaited<ReturnType<typeof decideAndRespond>>

function withTripBrief(tripBrief: TripBrief) {
  mockPrisma.conversation.findUniqueOrThrow.mockResolvedValue({
    id: 'conv_1',
    tripBrief,
    bookingData: null,
    bookingCheckedAt: null,
    contact: { phone: '6281234567890' },
  } as never)
}

// persistTripBrief writes via a tagged-template `$executeRaw` call: `[templateStrings, patchJson, conversationId]`.
function tripBriefWrites(): Partial<TripBrief>[] {
  return mockPrisma.$executeRaw.mock.calls.map(([, patchJson]) => JSON.parse(patchJson as string) as Partial<TripBrief>)
}

function replyOf(d: Decision): string {
  return 'reply' in d ? d.reply : 'draft' in d ? d.draft : ''
}

function labelsOf(d: Decision): string[] {
  return (d.steps ?? []).map((s) => s.label)
}

function composerSystem(): string {
  const calls = vi.mocked(callLLM).mock.calls.filter(([, opts]) => opts?.system?.startsWith('You are a real member of the JVTO'))
  expect(calls).toHaveLength(1)
  const system = calls[0][1]?.system
  if (system === undefined) throw new Error('the composing callLLM call carried no system prompt')
  return system
}

// One turn against a fresh write log, so each result's writes belong to that turn alone.
async function turn(text: string, tripBrief: TripBrief = {}): Promise<{ decision: Decision; writes: Partial<TripBrief>[] }> {
  withTripBrief(tripBrief)
  mockPrisma.$executeRaw.mockClear()
  vi.mocked(callLLM).mockClear()
  const decision = await decideAndRespond('conv_1', text)
  return { decision, writes: tripBriefWrites() }
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.clearAllMocks()
  vi.mocked(ensureFreshBookingData).mockResolvedValue(null)
  vi.mocked(checkDeploymentGate).mockReturnValue({ readyForApproval: true, blocking: [] })
  vi.mocked(callLLM).mockResolvedValue('A real reply.')
  mockPrisma.settings.findUniqueOrThrow.mockResolvedValue({ ollamaModel: 'gemma4:31b-cloud' } as never)
  mockPrisma.message.findMany.mockResolvedValue([] as never)
  // Zero published revisions -- the real loader's `available: true` state (see orchestrator.real.test.ts, Ruling R78).
  mockPrisma.knowledgeRevision.findMany.mockResolvedValue([] as never)
  withTripBrief({})
})

describe.skipIf(!RELEASE_PRESENT)('East Java region against the real route gate + real catalog (Ruling R106)', () => {
  it('resolves the live report text to the token its narrowed package passes through', () => {
    const catalog = loadCatalog()
    const parsed = parseTripPreferences(LIVE_TEXT)
    const prefs = { origin: parsed.origin, finishCity: parsed.finishCity, dayCount: parsed.dayCount }
    expect(prefs).toEqual({ origin: 'Surabaya', finishCity: 'bali', dayCount: 4 })

    const region = resolveRegionDestination(LIVE_TEXT, catalog, prefs)
    expect(region?.pool.map((p) => p.packageKey)).toEqual([LIVE_PACKAGE])
    expect(region?.destination).toBe(LIVE_TOKEN)

    // What the next turn does with the persisted token: the same narrowing over
    // packagesForDestination(token) still contains the package this turn narrowed to.
    const carried = narrowPackagePool(packagesForDestination(LIVE_TOKEN, catalog), { ...prefs, pax: null }, [])
    expect(carried.pool.map((p) => p.packageKey)).toContain(LIVE_PACKAGE)
  })

  // Case 1. Before R106 this reply was TECHNICAL_HICCUP_REPLY ('Paket ditolak').
  it('answers the live report text through the route gate and persists the real token, never the region', async () => {
    const { decision, writes } = await turn(LIVE_TEXT)

    expect(decision.mode).toBe('faq')
    expect(replyOf(decision)).not.toContain(HICCUP)
    expect(replyOf(decision)).not.toContain(DESTINATION_LIST)
    const labels = labelsOf(decision)
    expect(labels).toContain('Wilayah dikenali')
    expect((decision.steps ?? []).find((s) => s.label === 'Wilayah dikenali')?.detail).toContain(`semuanya melewati "${LIVE_TOKEN}"`)
    expect(labels).toContain('Paket valid')
    expect(labels).not.toContain('Paket ditolak')

    const destinations = writes.map((w) => w.destination).filter((d): d is string => d !== undefined)
    expect(destinations.length).toBeGreaterThan(0)
    expect(new Set(destinations)).toEqual(new Set([LIVE_TOKEN]))

    // The grounding is the package the customer's stated trip actually narrowed to.
    expect(composerSystem()).toContain(LIVE_PACKAGE)
  })

  // Case 2. A destination-independent question that merely names the region: no prefs, so the
  // whole catalog is the pool, no single token is shared, and the turn is the no-region baseline.
  it('treats "How much is the deposit for the East Java tour?" exactly like the same question without the region', async () => {
    const withRegion = await turn('How much is the deposit for the East Java tour?')
    const baseline = await turn('How much is the deposit for the tour?')

    expect(baseline.decision.mode).toBe('faq')
    expect(withRegion.decision.mode).toBe(baseline.decision.mode)
    expect(labelsOf(withRegion.decision)).toEqual(labelsOf(baseline.decision))
    expect(replyOf(withRegion.decision)).toBe(replyOf(baseline.decision))
    expect(withRegion.writes).toEqual(baseline.writes)
    expect(labelsOf(withRegion.decision)).not.toContain('Wilayah dikenali')
  })

  // Case 3.
  it('treats "Hi, I\'m interested in an East Java tour" exactly like the same greeting without the region', async () => {
    const withRegion = await turn("Hi, I'm interested in an East Java tour")
    const baseline = await turn("Hi, I'm interested in a tour")

    expect(replyOf(withRegion.decision)).not.toContain(HICCUP)
    expect(withRegion.decision.mode).toBe(baseline.decision.mode)
    expect(labelsOf(withRegion.decision)).toEqual(labelsOf(baseline.decision))
    expect(replyOf(withRegion.decision)).toBe(replyOf(baseline.decision))
    expect(withRegion.writes).toEqual(baseline.writes)
    expect(labelsOf(withRegion.decision)).not.toContain('Wilayah dikenali')
  })

  // Case 4. This message alone WOULD resolve -- a 2-day trip finishing in Ketapang narrows the
  // catalog to ijen-2d1n, whose only token is 'ijen' -- so only the tripBrief guard keeps the
  // destination the conversation already established.
  it('never lets a region override a destination already on file', async () => {
    expect(resolveRegionDestination('Could we do a 2 day East Java tour ending in Ketapang?', loadCatalog(), { origin: null, finishCity: 'ketapang', dayCount: 2 })?.destination).toBe('ijen')

    const { decision, writes } = await turn('Could we do a 2 day East Java tour ending in Ketapang?', { destination: 'bromo' })

    expect(labelsOf(decision)).not.toContain('Wilayah dikenali')
    expect((decision.steps ?? []).find((s) => s.label === 'Destinasi ditemukan')?.detail).toBe('Destinasi: "bromo".')
    for (const w of writes) {
      if (w.destination !== undefined) expect(w.destination).toBe('bromo')
    }
  })

  // Case 5. With a loose substring match this message resolves (the prefs narrow to the live
  // report's package); word boundaries keep "Javanese" from reading as the region.
  it('does not treat "East Javanese food" as the region', async () => {
    const { decision, writes } = await turn('Is East Javanese food very spicy? We are thinking of a 4D3N tour from Surabaya, continuing to Bali afterwards.')

    expect(labelsOf(decision)).not.toContain('Wilayah dikenali')
    expect(labelsOf(decision)).not.toContain('Destinasi ditemukan')
    expect(writes.filter((w) => w.destination !== undefined)).toEqual([])
  })

  // Case 6. The follow-up that used to inherit tripBrief.destination = 'east java' and get the
  // hiccup on every later turn.
  it('answers a deposit follow-up on the turn after the live report text, from the persisted token', async () => {
    const first = await turn(LIVE_TEXT)
    const carried: TripBrief = Object.assign({}, ...first.writes)
    expect(carried.destination).toBe(LIVE_TOKEN)

    const { decision } = await turn('ok thanks, and how much is the deposit?', carried)

    expect(decision.mode).toBe('faq')
    expect(replyOf(decision)).not.toContain(HICCUP)
    expect(labelsOf(decision)).toContain('Paket valid')
    expect(labelsOf(decision)).not.toContain('Paket ditolak')
  })
})

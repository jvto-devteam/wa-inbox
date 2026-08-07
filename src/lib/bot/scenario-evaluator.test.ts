import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import {
  evaluateScenario,
  loadScenarioDatasets,
  __resetScenarioDatasetsForTests,
  parsePickupTiming,
  buildItineraryScenario,
  describeScenarioForLLM,
  type ItineraryScenario,
} from './scenario-evaluator'

describe('parsePickupTiming', () => {
  it('parses an explicit 24h clock time', () => {
    expect(parsePickupTiming('pickup at 18:00 from the airport')).toEqual({ type: 'airport', time: '18:00' })
  })

  it('parses "jam N sore/malam" (Indonesian day-part + hour)', () => {
    expect(parsePickupTiming('pickup jam 6 sore dari bandara').time).toBe('18:00')
    expect(parsePickupTiming('jam 7 malam').time).toBe('19:00')
    expect(parsePickupTiming('jam 7 pagi').time).toBe('07:00')
  })

  it('detects pickup type independent of case/wording', () => {
    expect(parsePickupTiming('picking up from Surabaya Airport').type).toBe('airport')
    expect(parsePickupTiming('jemput di hotel kami').type).toBe('hotel')
    expect(parsePickupTiming('pickup at the harbor').type).toBe('harbor')
    expect(parsePickupTiming('naik kereta, jemput di stasiun').type).toBe('train_station')
  })

  // Found during a proactive audit 2026-08-07: "flight" (AIRPORT_KEYWORDS) and "hotel"
  // (HOTEL_KEYWORDS) can both appear in one real message -- a customer mentioning their past
  // arrival as backstory while actually wanting pickup from their hotel now. The old
  // first-match-wins scan confidently returned 'airport' (wrong -- they're at the hotel), and
  // this type feeds a reply that bypasses the LLM entirely, so a wrong type here is a genuinely
  // wrong statement shipped to the customer, not a silent miss. Returning null when multiple
  // location types are named is safe -- it's the exact same "no bonus recommendation" outcome
  // as any other not-confidently-known case (see the "nothing is stated" test below).
  it('returns null (not a guess) when the message names more than one location type', () => {
    const result = parsePickupTiming(
      'our flight already landed a while ago, we are resting at our hotel now, please pick us up at 6pm'
    )
    expect(result.type).toBeNull()
  })

  // Deliberately conservative: bare "sore" alone maps BELOW the real 17:00 late-arrival
  // threshold since Indonesian "sore" genuinely spans both sides of it -- a bare mention
  // must never manufacture a confident "limited rest time" warning out of an ambiguous word.
  it('maps a bare "sore" (no explicit hour) below the late-arrival threshold, conservatively', () => {
    const t = parsePickupTiming('pickup sore hari dari bandara').time
    expect(t).toBe('16:00')
  })

  it('maps a bare "malam" (unambiguous) above the late-arrival threshold', () => {
    expect(parsePickupTiming('pickup malam hari').time).toBe('19:00')
  })

  it('returns null for both fields when nothing is stated', () => {
    expect(parsePickupTiming('is ijen safe?')).toEqual({ type: null, time: null })
  })
})

const RELEASE_PRESENT = fs.existsSync(path.join(process.cwd(), 'catalog', 'itinerary-intelligence', '12-recommendation-rules.json'))

beforeEach(() => {
  __resetScenarioDatasetsForTests()
})

// Mirrors jvto-itinerary-core's own evaluateScenario.test.ts acceptance cases (see that
// repo's samples/*.json) -- confirms the port behaves identically against the real, copied
// datasets, not just against a mocked fixture.
describe.skipIf(!RELEASE_PRESENT)('evaluateScenario against the real copied itinerary-intelligence data', () => {
  it('flags a late airport arrival before Bromo/Ijen as possible_with_warning, recommending Bromo before Ijen', () => {
    const scenario: ItineraryScenario = {
      scenario_id: 'test_late_airport',
      pickup: { type: 'airport', location: 'Surabaya Airport', time: '18:00' },
      dropoff: { type: 'harbor', location: 'Ketapang Harbor' },
      pax: 2,
      duration_days: 3,
      requested_destinations: ['Ijen', 'Bromo'], // stated in the "wrong" order on purpose
      arrival_time: '18:00',
    }
    const result = evaluateScenario(scenario, loadScenarioDatasets())
    expect(result.status).toBe('possible_with_warning')
    expect(result.warnings.some((w) => w.toLowerCase().includes('rest'))).toBe(true)
    // Bromo comes before Ijen in the recommended route regardless of the order requested.
    const bromoIdx = result.recommended_route.findIndex((r) => r.toLowerCase().includes('bromo'))
    const ijenIdx = result.recommended_route.findIndex((r) => r.toLowerCase().includes('ijen'))
    expect(bromoIdx).toBeGreaterThanOrEqual(0)
    expect(ijenIdx).toBeGreaterThan(bromoIdx)
  })

  it('does not warn for an early hotel pickup with the same destinations', () => {
    const scenario: ItineraryScenario = {
      scenario_id: 'test_early_hotel',
      pickup: { type: 'hotel', location: 'Surabaya Hotel', time: '06:00' },
      dropoff: { type: 'bali_area', location: 'Bali Hotel' },
      pax: 2,
      duration_days: 3,
      requested_destinations: ['Bromo', 'Ijen'],
      arrival_time: '06:00',
    }
    const result = evaluateScenario(scenario, loadScenarioDatasets())
    expect(result.status).toBe('recommended')
    expect(result.warnings).toEqual([])
  })

  it('marks an impossible 1-day multi-destination request as not_recommended', () => {
    const scenario: ItineraryScenario = {
      scenario_id: 'test_impossible',
      pickup: { type: 'airport', location: 'Surabaya Airport', time: '21:30' },
      dropoff: { type: 'airport', location: 'Surabaya Airport' },
      pax: 2,
      duration_days: 1,
      requested_destinations: ['Bromo', 'Madakaripura', 'Ijen'],
      arrival_time: '21:30',
    }
    const result = evaluateScenario(scenario, loadScenarioDatasets())
    expect(result.status).toBe('not_recommended')
  })

  // The operator's own example, verbatim: Surabaya pickup in the afternoon/evening, requesting
  // Ijen then Bromo -- the real rule reorders to Bromo first (shorter, safer leg) and explains
  // the rest-time tradeoff via `late_airport_arrival_requires_rest_warning`'s recommendation text.
  it("reorders Ijen-then-Bromo to Bromo-first for a late Surabaya pickup, matching the operator's own example", () => {
    const scenario: ItineraryScenario = {
      scenario_id: 'test_operator_example',
      pickup: { type: 'airport', location: 'Surabaya Airport', time: '19:00' },
      dropoff: { type: 'harbor', location: 'Ketapang Harbor' },
      pax: 2,
      duration_days: 3,
      requested_destinations: ['Ijen', 'Bromo'],
      arrival_time: '19:00',
    }
    const result = evaluateScenario(scenario, loadScenarioDatasets())
    expect(result.recommended_route.join(' -> ').toLowerCase()).toMatch(/bromo.*ijen/)
    const rule = loadScenarioDatasets().rules.find((r) => r.id === 'late_airport_arrival_requires_rest_warning')
    expect(result.warnings).toContain(String(rule?.recommendation))
  })

  // End-to-end: exactly the flow orchestrator.ts runs -- parse the customer's own words, build
  // a scenario from what's known, evaluate, and describe the result for the LLM.
  it('end-to-end: "pickup Surabaya jam 6 sore, mau ke Bromo dan Ijen" produces a Bromo-first note with a rest-time explanation', () => {
    const message = 'pickup Surabaya jam 6 sore, mau ke Bromo dan Ijen, mana yang harus duluan?'
    const timing = parsePickupTiming(message)
    expect(timing).toEqual({ type: null, time: '18:00' }) // no airport/hotel keyword in this exact message
    const scenario = buildItineraryScenario({
      origin: 'Surabaya',
      pickupType: 'airport', // as if the conversation history already established an airport pickup
      pickupTime: timing.time!,
      requestedTokens: ['ijen', 'bromo'],
      finishCity: 'ketapang',
      dayCount: 3,
      pax: 2,
    })
    const description = describeScenarioForLLM(evaluateScenario(scenario))
    expect(description).toBeTruthy()
    expect(description!.toLowerCase()).toMatch(/bromo.*ijen/)
    expect(description!.toLowerCase()).toContain('rest')
  })

  it('describeScenarioForLLM returns null when there is nothing worth surfacing (single destination, no warnings)', () => {
    const scenario = buildItineraryScenario({
      origin: 'Surabaya',
      pickupType: 'hotel',
      pickupTime: '08:00',
      requestedTokens: ['bromo'],
      finishCity: null,
      dayCount: 1,
      pax: 2,
    })
    expect(describeScenarioForLLM(evaluateScenario(scenario))).toBeNull()
  })
})

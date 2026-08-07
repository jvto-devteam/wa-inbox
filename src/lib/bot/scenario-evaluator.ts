/**
 * Route/rest-time scenario evaluator -- a direct port of jvto-itinerary-core's
 * `src/scenario/evaluateScenario.ts` (see .../jvto-itinerary-core/src/scenario/evaluateScenario.ts),
 * copied in per the operator's explicit direction 2026-08-06 ("salin aja, duplicate, gak perlu
 * sync, kalo ada update tinggal update data manual") rather than calling that repo's
 * `scenario-server.ts` HTTP service (which is built and tested but was never deployed anywhere).
 *
 * This answers a real, recurring class of customer question the earlier knowledge-gap audit
 * never surfaced because it isn't a missing FACT -- it's missing REASONING: "we're picked up
 * from Surabaya in the afternoon, should we do Bromo or Ijen first?" needs an answer that
 * weighs rest time, not a single static fact to quote. jvto-itinerary-core already has this
 * fully built and backoffice-data-informed (e.g. `late_airport_arrival_requires_rest_warning`
 * is backed by 9 real observed late-arrival bookings, not a guess) -- it was simply never wired
 * into the bot that actually talks to customers.
 *
 * Logic is copied close to verbatim; the only real change is data loading (this repo's
 * `readCatalogFile` against `catalog/itinerary-intelligence/*.json`, copied from that repo's
 * `generated/itinerary-intelligence/*.json`, instead of that repo's own file-path-based
 * `loadDatasets`/`GENERATED_DIR`). Only the 10 dataset files `evaluateScenario` actually reads
 * were copied (01, 02, 04, 06-12) -- the source repo has ~50 other generated files (pricing,
 * hotels, activities master data, etc.) this bot has no use for.
 */
import { readCatalogFile } from './catalog'

// ─── Domain types (jvto-itinerary-core's src/domain/itinerary.ts + domain/common.ts) ───
export type LocationType =
  | 'airport'
  | 'hotel'
  | 'train_station'
  | 'harbor'
  | 'city_point'
  | 'custom_address'
  | 'bali_area'
  | 'destination_area'

export type TravelEndpoint = {
  type: LocationType
  location: string
  detail?: string
  time?: string
  ticket_number?: string
}

export type ItineraryScenario = {
  scenario_id: string
  channel?: 'JVTO' | 'KLOOK' | 'TWT' | 'CUSTOM'
  package_slug?: string
  pickup: TravelEndpoint
  dropoff: TravelEndpoint
  pax: number
  duration_days: number
  requested_destinations: string[]
  arrival_time?: string
  departure_deadline?: string
  hotel_preference?: string
  route_preference?: string
  luggage_context?: string
}

export type SourceTrace = {
  source: 'llm_wiki' | 'jvto_web' | 'new_backoffice' | 'manual_seed' | 'generated' | 'tomtom'
  ref: string
  field?: string
  confidence?: string
}

export type ScenarioEvaluation = {
  status: 'recommended' | 'possible_with_warning' | 'not_recommended' | 'needs_manual_review'
  recommended_route: string[]
  route_leg_ids: string[]
  package_route_id: string | null
  warnings: string[]
  operational_events: string[]
  meal_logic: string[]
  accommodation_logic: string[]
  cost_components: string[]
  better_route_notes: string[]
  next_required_info: string[]
  source_trace: SourceTrace[]
}

type Row = Record<string, unknown>
type Datasets = {
  pickups: Row[]
  dropoffs: Row[]
  legs: Row[]
  destinations: Row[]
  events: Row[]
  meals: Row[]
  accommodations: Row[]
  costs: Row[]
  packageRoutes: Row[]
  rules: Row[]
}

function loadJsonArray(fileName: string): Row[] {
  const data = readCatalogFile(`itinerary-intelligence/${fileName}`)
  return Array.isArray(data) ? (data as Row[]) : []
}

let _datasets: Datasets | null = null

/** Lazily loaded, cached for the process lifetime -- same pattern as knowledge.ts's loadModules. */
export function loadScenarioDatasets(): Datasets {
  if (_datasets) return _datasets
  _datasets = {
    pickups: loadJsonArray('01-pickup-contexts.json'),
    dropoffs: loadJsonArray('02-dropoff-contexts.json'),
    legs: loadJsonArray('04-route-leg-index.json'),
    destinations: loadJsonArray('06-destination-activity-profiles.json'),
    events: loadJsonArray('07-operational-events.json'),
    meals: loadJsonArray('08-meal-logic.json'),
    accommodations: loadJsonArray('09-accommodation-logic.json'),
    costs: loadJsonArray('10-cost-components.json'),
    packageRoutes: loadJsonArray('11-package-route-map.json'),
    rules: loadJsonArray('12-recommendation-rules.json'),
  }
  return _datasets
}

/** Test-only: clears the lazy cache so a test's own fixtures aren't shadowed by real data. */
export function __resetScenarioDatasetsForTests(): void {
  _datasets = null
}

// ─── Cost-ID alias layer (jvto-itinerary-core's src/config/cost-aliases.ts, verbatim) ───
const COST_ALIASES: Record<string, string> = {
  vehicle_day_usage: 'vehicle_private_car_day',
  ketapang_dropoff: 'vehicle_private_car_day',
  vehicle_crossing_or_handoff: 'ferry_ticket',
  bromo_ticket: 'bromo_entrance_fee',
  ijen_ticket: 'ijen_entrance_fee',
  madakaripura_ticket: 'destination_ticket',
  tumpak_sewu_ticket: 'destination_ticket',
  papuma_ticket: 'destination_ticket',
  destination_ticket_if_selected: 'destination_ticket',
  medical_check: 'ijen_medical_check',
  ijen_preparation: 'ijen_medical_check',
  dinner_bondowoso: 'restaurant_meal',
  lunch_after_tumpak_sewu: 'restaurant_meal',
  hotel_bromo_area: 'hotel_room',
  waterfall_local_guide: 'madakaripura_local_guide',
  optional_bali_transfer: 'bali_dropoff_after_ketapang',
  bali_transfer: 'bali_dropoff_after_ketapang',
  bali_transfer_optional: 'bali_dropoff_after_ketapang',
}
function resolveCostId(tag: string, canonical: ReadonlySet<string>): string | null {
  if (canonical.has(tag)) return tag
  const aliased = COST_ALIASES[tag]
  if (aliased && canonical.has(aliased)) return aliased
  return null
}

// ─── Destination normalization ───
const DEST_ALIASES: Record<string, string> = {
  bromo: 'bromo',
  'mount bromo': 'bromo',
  ijen: 'ijen',
  'kawah ijen': 'ijen',
  madakaripura: 'madakaripura',
  'tumpak sewu': 'tumpak_sewu',
  tumpak_sewu: 'tumpak_sewu',
  papuma: 'papuma',
  malang: 'malang_batu',
  batu: 'malang_batu',
  'malang/batu': 'malang_batu',
}
function normDest(raw: string): string | null {
  return DEST_ALIASES[raw.trim().toLowerCase()] ?? null
}

// Corridor destinations in west->east geographic order. Madakaripura is a SPUR (out-and-back
// from Bromo), not a corridor node.
const CORRIDOR_WEST_TO_EAST = ['tumpak_sewu', 'bromo', 'ijen'] as const
const SPUR_BASE: Record<string, string> = { madakaripura: 'bromo' }

// ─── Area-key mapping (labels in the datasets -> routing node keys) ───
function areaKey(label: string): string | null {
  const l = label.toLowerCase()
  if (l.includes('surabaya') && l.includes('airport')) return 'sby_airport'
  if (l.includes('surabaya') && l.includes('hotel')) return 'sby_hotel'
  if (l.includes('surabaya')) return 'sby'
  if (l.includes('bromo')) return 'bromo'
  if (l.includes('madakaripura')) return 'madakaripura'
  if (l.includes('tumpak')) return 'tumpak'
  if (l.includes('bondowoso') || l.includes('ijen') || l.includes('banyuwangi')) return 'ijen_area'
  if (l.includes('ketapang')) return 'ketapang'
  if (l.includes('gilimanuk') || l.includes('bali')) return 'bali'
  if (l.includes('malang')) return 'malang'
  return null
}

const DEST_NODE: Record<string, { area: string; label: string }> = {
  tumpak_sewu: { area: 'tumpak', label: 'Tumpak Sewu Area' },
  bromo: { area: 'bromo', label: 'Bromo Area' },
  ijen: { area: 'ijen_area', label: 'Bondowoso / Ijen Area' },
  madakaripura: { area: 'madakaripura', label: 'Madakaripura Waterfall' },
}

const REGION = {
  west: new Set(['sby_airport', 'sby_hotel', 'sby', 'malang']),
  east: new Set(['ketapang', 'bali']),
}

function areaToDest(area: string | null): string | null {
  switch (area) {
    case 'bromo':
      return 'bromo'
    case 'ijen_area':
      return 'ijen'
    case 'tumpak':
      return 'tumpak_sewu'
    case 'madakaripura':
      return 'madakaripura'
    case 'malang':
      return 'malang_batu'
    default:
      return null
  }
}

function pickupNode(p: { type?: string; location?: string }): { area: string; label: string } | null {
  const loc = (p.location ?? '').toLowerCase()
  const type = (p.type ?? '').toLowerCase()
  if (loc.includes('bali')) return { area: 'bali', label: 'Bali Hotel Area' }
  if (loc.includes('ketapang') || type === 'harbor') return { area: 'ketapang', label: 'Ketapang Harbor' }
  if (loc.includes('malang')) return { area: 'malang', label: 'Malang' }
  if (type === 'airport') return { area: 'sby_airport', label: 'Surabaya Airport' }
  if (type === 'hotel') return { area: 'sby_hotel', label: 'Surabaya Hotel' }
  if (loc.includes('surabaya')) return { area: 'sby', label: 'Surabaya' }
  return null
}

function dropoffNodes(d: { type?: string; location?: string }): Array<{ area: string; label: string }> {
  const loc = (d.location ?? '').toLowerCase()
  const type = (d.type ?? '').toLowerCase()
  if (loc.includes('bali') || type === 'bali_area')
    return [
      { area: 'ketapang', label: 'Ketapang Harbor' },
      { area: 'bali', label: 'Gilimanuk / Bali side' },
    ]
  if (loc.includes('ketapang') || type === 'harbor') return [{ area: 'ketapang', label: 'Ketapang Harbor' }]
  if (loc.includes('malang')) return [{ area: 'malang', label: 'Malang' }]
  if (loc.includes('surabaya') && type === 'airport') return [{ area: 'sby_airport', label: 'Surabaya Airport' }]
  if (loc.includes('surabaya')) return [{ area: 'sby', label: 'Surabaya' }]
  return []
}

function parseHHMM(t?: string): number | null {
  if (!t || !/^\d{1,2}:\d{2}$/.test(t)) return null
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

function buildLegLookup(legs: Row[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const leg of legs) {
    const from = areaKey(String(leg.from_location ?? ''))
    const to = areaKey(String(leg.to_location ?? ''))
    if (!from || !to || from === to) continue
    map.set(`${from}->${to}`, String(leg.id))
  }
  return map
}
function resolveLeg(map: Map<string, string>, from: string, to: string): string | null {
  if (map.has(`${from}->${to}`)) return map.get(`${from}->${to}`)!
  const genFrom = from === 'sby_airport' || from === 'sby_hotel' ? 'sby' : from
  if (genFrom !== from && map.has(`${genFrom}->${to}`)) return map.get(`${genFrom}->${to}`)!
  return null
}

/**
 * Ported near-verbatim from jvto-itinerary-core's `evaluateScenario` -- see this file's own
 * header for what changed (data loading only) and why this exists at all.
 */
export function evaluateScenario(scenario: ItineraryScenario, datasets: Datasets = loadScenarioDatasets()): ScenarioEvaluation {
  const warnings: string[] = []
  const betterRouteNotes: string[] = []
  const nextRequiredInfo: string[] = []

  const canonicalCostIds = new Set(datasets.costs.map((c) => String(c.id)))
  const ruleText = (id: string): string => {
    const r = datasets.rules.find((x) => x.id === id)
    return r ? String(r.recommendation ?? id) : id
  }

  const requested = Array.isArray(scenario.requested_destinations) ? scenario.requested_destinations : []
  const resolvedDests = requested.map(normDest)
  const unknownDest = resolvedDests.some((d) => d === null)
  const dests = new Set(resolvedDests.filter((d): d is string => d !== null))
  const mains = CORRIDOR_WEST_TO_EAST.filter((d) => dests.has(d))
  const spurs = Object.keys(SPUR_BASE).filter((d) => dests.has(d))

  const startNode = pickupNode(scenario.pickup ?? { type: undefined, location: undefined })
  const endNodes = dropoffNodes(scenario.dropoff ?? { type: undefined, location: undefined })

  const startArea = startNode?.area
  const endArea = endNodes.length ? endNodes[endNodes.length - 1].area : undefined
  const reverse = !!(startArea && endArea && REGION.east.has(startArea) && REGION.west.has(endArea))
  const orderedMains = reverse ? [...mains].reverse() : mains

  const requestedMainOrder = resolvedDests.filter((d): d is string => !!d && (CORRIDOR_WEST_TO_EAST as readonly string[]).includes(d))
  if (!reverse && requestedMainOrder.join(',') !== orderedMains.join(',') && (endArea === 'ketapang' || endArea === 'bali')) {
    warnings.push(ruleText('avoid_backtracking_ijen_bromo_ketapang'))
    betterRouteNotes.push('Reordered destinations west-to-east (Surabaya -> Bromo -> Ijen -> Ketapang/Bali) to avoid backtracking.')
  }

  const recommendedRoute: string[] = []
  const routeLegIds: string[] = []
  const legMap = buildLegLookup(datasets.legs)

  const nodeSeq: Array<{ area: string; label: string }> = []
  if (startNode) nodeSeq.push(startNode)
  for (const d of orderedMains) nodeSeq.push(DEST_NODE[d])
  for (const e of endNodes) {
    if (!nodeSeq.length || nodeSeq[nodeSeq.length - 1].area !== e.area) nodeSeq.push(e)
  }

  let unresolvedLeg = false
  for (let i = 0; i < nodeSeq.length; i++) {
    recommendedRoute.push(nodeSeq[i].label)
    if (i === 0) continue
    const legId = resolveLeg(legMap, nodeSeq[i - 1].area, nodeSeq[i].area)
    if (legId) routeLegIds.push(legId)
    else {
      betterRouteNotes.push(`No direct route leg defined for ${nodeSeq[i - 1].label} -> ${nodeSeq[i].label} (needs verification).`)
      unresolvedLeg = true
    }
  }

  if (dests.has('ijen')) {
    const craterLeg = datasets.legs.find((l) => String(l.to_location ?? '').toLowerCase().includes('ijen crater'))
    const ijenNode = nodeSeq.find((n) => n.area === 'ijen_area')
    if (craterLeg && ijenNode) {
      const craterId = String(craterLeg.id)
      const labelIdx = recommendedRoute.indexOf(ijenNode.label)
      if (labelIdx >= 0 && recommendedRoute[labelIdx + 1] !== 'Ijen Crater') {
        recommendedRoute.splice(labelIdx + 1, 0, 'Ijen Crater')
      }
      if (!routeLegIds.includes(craterId)) {
        const arriveIdx = routeLegIds.findIndex((id) => {
          const leg = datasets.legs.find((l) => l.id === id)
          return leg && areaKey(String(leg.to_location ?? '')) === 'ijen_area'
        })
        if (arriveIdx >= 0) routeLegIds.splice(arriveIdx + 1, 0, craterId)
        else routeLegIds.push(craterId)
      }
    }
  }

  let packageRouteId: string | null = null
  if (scenario.package_slug) {
    const pkg = datasets.packageRoutes.find((p) => p.package_id === scenario.package_slug)
    if (!pkg) {
      betterRouteNotes.push(`package_slug "${scenario.package_slug}" not found in 11-package-route-map; using derived route.`)
    } else {
      packageRouteId = String(pkg.package_id)
      const seq = (pkg.route_sequence as string[] | undefined) ?? []
      const pkgLegs = ((pkg.route_legs as string[] | undefined) ?? []).filter((id) => datasets.legs.some((l) => l.id === id))
      if (seq.length) {
        recommendedRoute.length = 0
        recommendedRoute.push(...seq)
      }
      if (pkgLegs.length) {
        routeLegIds.length = 0
        routeLegIds.push(...pkgLegs)
      }
      const pkgDestKeys = new Set(seq.map((s) => areaToDest(areaKey(s))).filter((d): d is string => !!d))
      for (const d of dests) {
        if (!pkgDestKeys.has(d)) {
          warnings.push(`Requested destination "${d}" is not part of package route "${packageRouteId}"; package route may need adjustment.`)
        }
      }
      const pkgEndArea = seq.length ? areaKey(seq[seq.length - 1]) : null
      if (pkgEndArea && endArea && pkgEndArea !== endArea && !(REGION.east.has(pkgEndArea) && REGION.east.has(endArea))) {
        warnings.push(`Package route "${packageRouteId}" ends at "${seq[seq.length - 1]}" but requested dropoff resolves to "${endArea}"; confirm dropoff handling.`)
      }
    }
  }

  const traversedLegIds = [...routeLegIds]
  for (const spur of spurs) {
    const base = SPUR_BASE[spur]
    const baseArea = DEST_NODE[base]?.area
    const spurArea = DEST_NODE[spur]?.area
    const legId = baseArea && spurArea ? resolveLeg(legMap, baseArea, spurArea) : null
    if (legId) {
      traversedLegIds.push(legId)
      const baseLabel = DEST_NODE[base]?.label
      const idx = recommendedRoute.indexOf(baseLabel)
      if (idx >= 0) recommendedRoute.splice(idx + 1, 0, DEST_NODE[spur].label)
      const arriveIdx = routeLegIds.findIndex((id) => {
        const leg = datasets.legs.find((l) => l.id === id)
        return leg && areaKey(String(leg.to_location ?? '')) === baseArea
      })
      if (arriveIdx >= 0) routeLegIds.splice(arriveIdx + 1, 0, legId)
      else routeLegIds.push(legId)
    } else {
      betterRouteNotes.push(`No route leg defined for ${base} -> ${spur} spur (needs verification).`)
      unresolvedLeg = true
    }
  }

  const operationalEvents: string[] = []
  const dropoffExtra = scenario.dropoff as unknown as Record<string, unknown> | undefined
  const nextDestination = String(dropoffExtra?.next_destination ?? '').toLowerCase()
  const ketapangContinuesToBali =
    endArea === 'ketapang' &&
    (nextDestination.includes('bali') || nextDestination.includes('gilimanuk') || dropoffExtra?.ferry_or_bali_transfer_preference != null)
  const continuesToBali = endArea === 'bali' || ketapangContinuesToBali
  const eventApplicable: Record<string, boolean> = {
    bromo_jeep_handoff: dests.has('bromo'),
    waterfall_local_guide_handoff: dests.has('madakaripura') || dests.has('tumpak_sewu'),
    bondowoso_dinner_medical_check: dests.has('ijen'),
    ketapang_ferry_connection: continuesToBali,
  }
  for (const ev of datasets.events) {
    if (eventApplicable[String(ev.id)]) operationalEvents.push(String(ev.id))
  }

  const longTransfer = routeLegIds.length >= 3 || mains.length >= 2
  const mealApplicable: Record<string, boolean> = {
    dinner_before_ijen: dests.has('ijen'),
    takeaway_breakfast_after_ijen_or_bromo: dests.has('ijen') || dests.has('bromo'),
    lunch_stop_own_expense_long_transfer: longTransfer,
  }
  const meal_logic = datasets.meals.filter((m) => mealApplicable[String(m.id)]).map((m) => String(m.id))

  const baliOrigin = startArea === 'bali'
  const accApplicable: Record<string, boolean> = {
    bromo_area_sunrise_staging: dests.has('bromo'),
    bondowoso_ijen_staging: dests.has('ijen') && !baliOrigin,
    banyuwangi_staging: dests.has('ijen') && baliOrigin,
    tumpak_sewu_staging: dests.has('tumpak_sewu'),
    papuma_staging: dests.has('papuma'),
    malang_batu_staging: dests.has('malang_batu') || endArea === 'malang',
  }
  const accommodation_logic = datasets.accommodations.filter((a) => accApplicable[String(a.area_id)]).map((a) => String(a.id))

  const rawCostTags = new Set<string>()
  for (const id of traversedLegIds) {
    const leg = datasets.legs.find((l) => l.id === id)
    for (const t of (leg?.cost_impacts as string[] | undefined) ?? []) rawCostTags.add(t)
  }
  for (const d of dests) {
    const prof = datasets.destinations.find((x) => x.destination_id === d)
    for (const t of (prof?.cost_components as string[] | undefined) ?? []) rawCostTags.add(t)
  }
  for (const evId of operationalEvents) {
    const ev = datasets.events.find((x) => x.id === evId)
    for (const t of (ev?.cost_components as string[] | undefined) ?? []) {
      if (t === 'waterfall_local_guide') {
        if (dests.has('madakaripura')) rawCostTags.add('madakaripura_local_guide')
        if (dests.has('tumpak_sewu')) rawCostTags.add('tumpak_sewu_local_guide')
      } else {
        rawCostTags.add(t)
      }
    }
  }
  const costComponents: string[] = []
  for (const tag of rawCostTags) {
    const id = resolveCostId(tag, canonicalCostIds)
    if (id && !costComponents.includes(id)) costComponents.push(id)
  }
  costComponents.sort()

  const arrival = parseHHMM(scenario.arrival_time ?? scenario.pickup?.time)
  const lateAirport = (scenario.pickup?.type ?? '').toLowerCase() === 'airport' && arrival !== null && arrival >= 17 * 60
  if (lateAirport && (dests.has('bromo') || dests.has('ijen'))) {
    warnings.push(ruleText('late_airport_arrival_requires_rest_warning'))
  }

  const lastMain = orderedMains[orderedMains.length - 1]
  const endsAtWaterfall = spurs.length > 0 && endArea === 'sby_airport' && lastMain === 'bromo'
  if (endArea === 'sby_airport' && (dests.has('tumpak_sewu') || dests.has('madakaripura')) && endsAtWaterfall) {
    warnings.push(ruleText('waterfall_before_airport_deadline_risk'))
  }

  const pickupCtx = datasets.pickups.find((p) => p.type === scenario.pickup?.type)
  const dropoffCtx = datasets.dropoffs.find((d) => d.type === scenario.dropoff?.type)
  const provided = (obj: Record<string, unknown> | undefined) => new Set(Object.keys(obj ?? {}))
  const pickupObj = scenario.pickup as unknown as Record<string, unknown> | undefined
  const dropoffObj = scenario.dropoff as unknown as Record<string, unknown> | undefined
  const pProvided = provided(pickupObj)
  const dProvided = provided(dropoffObj)
  for (const f of (pickupCtx?.required_customer_fields as string[] | undefined) ?? []) {
    const val = pickupObj?.[f]
    if (!pProvided.has(f) || val === 'TBD' || val === '' || val === undefined) nextRequiredInfo.push(`pickup: ${f}`)
  }
  for (const f of (dropoffCtx?.required_customer_fields as string[] | undefined) ?? []) {
    const val = dropoffObj?.[f]
    if (!dProvided.has(f) || val === 'TBD' || val === '' || val === undefined) nextRequiredInfo.push(`dropoff: ${f}`)
  }

  if (endArea === 'bali' || endArea === 'ketapang') {
    betterRouteNotes.push('Ketapang dropoff/Bali continuation needs a ferry queue buffer; confirm ferry-or-Bali-transfer preference.')
  }

  const minDays =
    (dests.has('ijen') ? 2 : dests.has('bromo') ? 1 : 1) + (dests.has('madakaripura') && dests.has('ijen') ? 1 : 0) + (dests.has('tumpak_sewu') ? 1 : 0)
  const days = typeof scenario.duration_days === 'number' ? scenario.duration_days : 0
  const tooShort = days < minDays
  const impossibleOvernight = days <= 1 && (mains.length >= 2 || dests.has('ijen'))

  let status: ScenarioEvaluation['status']
  if (!startNode || endNodes.length === 0 || unknownDest || mains.length === 0) {
    status = 'needs_manual_review'
    if (unknownDest) betterRouteNotes.push('One or more requested destinations are not in the dataset; manual review required.')
    if (!startNode) betterRouteNotes.push('Pickup location could not be normalized; manual review required.')
    if (endNodes.length === 0) betterRouteNotes.push('Dropoff location could not be normalized; manual review required.')
  } else if (tooShort || impossibleOvernight) {
    status = 'not_recommended'
    betterRouteNotes.push(`Requested ${days} day(s) is below the ~${minDays}-day minimum for destinations [${[...dests].join(', ')}]. Add nights or remove a destination.`)
  } else if (unresolvedLeg && !packageRouteId) {
    status = 'needs_manual_review'
    betterRouteNotes.push('One or more transfer legs between requested stops are undefined (e.g. a reverse-direction leg); manual review required before this route can be recommended.')
  } else if (warnings.length > 0) {
    status = 'possible_with_warning'
  } else {
    status = 'recommended'
  }

  const source_trace: SourceTrace[] = [
    { source: 'generated', ref: 'catalog/itinerary-intelligence/04-route-leg-index.json', confidence: 'inferred' },
    { source: 'generated', ref: 'catalog/itinerary-intelligence/06-destination-activity-profiles.json', confidence: 'inferred' },
    { source: 'generated', ref: 'catalog/itinerary-intelligence/12-recommendation-rules.json', confidence: 'inferred' },
  ]

  return {
    status,
    recommended_route: recommendedRoute,
    route_leg_ids: routeLegIds,
    package_route_id: packageRouteId,
    warnings,
    operational_events: operationalEvents,
    meal_logic,
    accommodation_logic,
    cost_components: costComponents,
    better_route_notes: betterRouteNotes,
    next_required_info: nextRequiredInfo,
    source_trace,
  }
}

// ─── Chat-text parsing: pickup type + time ───
// Reported 2026-08-06 (operator's own example): "pickup Surabaya sore, mau ke Bromo dan Ijen,
// mana yang harus duluan?" needs the customer's stated pickup TYPE and TIME to be captured at
// all -- neither existed anywhere in this bot before (package-match.ts's parseTripPreferences
// only ever captures the ORIGIN CITY, never a clock time or airport/hotel/harbor distinction).
const AIRPORT_KEYWORDS = ['airport', 'bandara', 'flight', 'penerbangan', 'landing', 'mendarat']
const HARBOR_KEYWORDS = ['harbor', 'harbour', 'pelabuhan', 'ferry terminal']
const TRAIN_KEYWORDS = ['train station', 'kereta', 'stasiun']
const HOTEL_KEYWORDS = ['hotel']

// Found during a proactive audit 2026-08-07: a real, plausible message like "our flight already
// landed a while ago, we're resting at our hotel now, please pick us up at 6pm" contains BOTH
// "flight" (AIRPORT_KEYWORDS) and "hotel" (HOTEL_KEYWORDS) -- the old first-match-wins scan
// confidently returned 'airport' (the customer's PAST arrival, mentioned only as backstory)
// instead of 'hotel' (where they actually want pickup FROM). This type feeds `forCustomer` text
// that bypasses the LLM entirely and goes straight into the reply, so a wrong-but-confident type
// here is a genuinely wrong, unreviewed statement shipped to the customer -- not a silent miss.
// Consistent with this whole feature's own documented design ("only proceed when BOTH type and
// time are confidently known, conservative by null" -- see evaluatePickupScenario's own header):
// when a message names MORE THAN ONE location type, that is itself evidence it is NOT
// confidently known which one is the actual pickup point, so this now returns null (same
// silent-no-recommendation outcome as any other "not confidently known" case) rather than
// guessing via arbitrary keyword-check order.
function detectPickupType(low: string): LocationType | null {
  const matches: LocationType[] = []
  if (AIRPORT_KEYWORDS.some((k) => low.includes(k))) matches.push('airport')
  if (HARBOR_KEYWORDS.some((k) => low.includes(k))) matches.push('harbor')
  if (TRAIN_KEYWORDS.some((k) => low.includes(k))) matches.push('train_station')
  if (HOTEL_KEYWORDS.some((k) => low.includes(k))) matches.push('hotel')
  return matches.length === 1 ? matches[0] : null
}

// "jam 6 sore"/"pukul 18" -> hour, adjusted for the stated day-part. 'pagi' (morning) is
// left as-is; 'siang'/'sore'/'malam' (midday/afternoon/evening) add 12 to an hour stated in
// 1-11 -- "jam 6 sore" -> 18, "jam 12 siang" -> 12 (already correct, not doubled).
const DAYPART_HOUR_ADJUST: Record<string, (h: number) => number> = {
  pagi: (h) => h,
  siang: (h) => (h < 12 ? h + 12 : h),
  sore: (h) => (h <= 11 ? h + 12 : h),
  malam: (h) => (h <= 11 ? h + 12 : h),
}

// Bare day-part words with NO explicit hour attached -- deliberately conservative
// representative anchor times, not a guess dressed up as precision. Indonesian "sore"
// genuinely spans both sides of the real late-arrival threshold (17:00) -- 15:00-18:00 -- so
// a bare "sore" maps BELOW it (16:00) rather than risk a false "limited rest time" warning
// for a customer who said "sore" but actually means an early-afternoon pickup with plenty of
// rest time. "malam" (evening/night) is unambiguous enough to map above the threshold.
const BARE_DAYPART_TIME: Record<string, string> = {
  pagi: '08:00',
  morning: '08:00',
  siang: '12:30',
  midday: '12:30',
  sore: '16:00',
  afternoon: '15:00',
  malam: '19:00',
  night: '19:00',
  evening: '18:00',
}

function parseExplicitClockTime(low: string): string | null {
  const hhmm = low.match(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\s*(am|pm)?\b/)
  if (hhmm) {
    let h = Number(hhmm[1])
    const ampm = hhmm[3]
    if (ampm === 'pm' && h < 12) h += 12
    if (ampm === 'am' && h === 12) h = 0
    return `${String(h).padStart(2, '0')}:${hhmm[2]}`
  }
  const jam = low.match(/\b(?:jam|pukul)\s+(\d{1,2})\s*(pagi|siang|sore|malam)?\b/)
  if (jam) {
    let h = Number(jam[1])
    const part = jam[2]
    if (h > 23) return null
    if (part) h = DAYPART_HOUR_ADJUST[part](h)
    if (h >= 0 && h <= 23) return `${String(h).padStart(2, '0')}:00`
  }
  return null
}

/**
 * A customer-stated pickup type (airport/hotel/harbor/train station) and/or time, parsed from
 * free text. Either field may be `null` when not stated -- callers should only build a full
 * `ItineraryScenario` (and call `evaluateScenario`) once BOTH are known, since the real
 * late-arrival rest-time rule specifically requires an airport pickup with a stated time; a
 * type or time guessed rather than stated would be exactly the kind of fabricated precision
 * this bot avoids elsewhere.
 */
export function parsePickupTiming(message: string): { type: LocationType | null; time: string | null } {
  const low = (message ?? '').toLowerCase()
  const type = detectPickupType(low)
  let time = parseExplicitClockTime(low)
  if (!time) {
    for (const [word, t] of Object.entries(BARE_DAYPART_TIME)) {
      if (new RegExp(`\\b${word}\\b`).test(low)) {
        time = t
        break
      }
    }
  }
  return { type, time }
}

// ─── Building a scenario from what the orchestrator already knows ───
function dropoffForFinishCity(finishCity: string | null): TravelEndpoint {
  switch (finishCity) {
    case 'bali':
      return { type: 'bali_area', location: 'Bali Hotel' }
    case 'ketapang':
      return { type: 'harbor', location: 'Ketapang Harbor' }
    case 'malang':
      return { type: 'custom_address', location: 'Malang' }
    case 'surabaya':
      return { type: 'hotel', location: 'Surabaya Hotel' }
    default:
      // Neutral default when the finish city genuinely isn't known yet: resolves to an area
      // outside REGION.east, so the Ketapang/Bali-specific backtracking-avoidance rule simply
      // doesn't fire (honest silence) rather than assuming a dropoff the customer never stated.
      return { type: 'hotel', location: 'Surabaya Hotel' }
  }
}

/**
 * Builds a best-effort `ItineraryScenario` from what orchestrator.ts already knows this turn
 * (origin, requested destination tokens, finish city, day count) plus the customer's stated
 * pickup type/time. `duration_days` is deliberately NOT the real customer-stated value unless
 * one is actually known -- a large placeholder (6, JVTO's real catalog max) is used otherwise,
 * specifically so the evaluator's day-count feasibility check never produces a false
 * "not enough days" signal; callers must ignore `evaluation.status` for that reason and use
 * only `recommended_route`/`warnings`/`better_route_notes`, which don't depend on duration_days.
 */
export function buildItineraryScenario(input: {
  origin: string | null
  pickupType: LocationType
  pickupTime: string
  requestedTokens: string[]
  finishCity: string | null
  dayCount: number | null
  pax: number | null
}): ItineraryScenario {
  const originLower = (input.origin ?? 'surabaya').toLowerCase()
  const pickupLocation = originLower === 'bali' ? 'Bali Hotel' : 'Surabaya Airport'
  return {
    scenario_id: 'wa-inbox-inline',
    channel: 'JVTO',
    pickup: { type: input.pickupType, location: originLower === 'bali' ? 'Bali Hotel Area' : pickupLocation, time: input.pickupTime },
    dropoff: dropoffForFinishCity(input.finishCity),
    pax: input.pax ?? 2,
    duration_days: input.dayCount ?? 6,
    requested_destinations: input.requestedTokens,
    arrival_time: input.pickupTime,
  }
}

/**
 * The customer-presentable substance of a `ScenarioEvaluation` -- `null` when there's nothing
 * worth surfacing. Gated on `warnings` specifically (not just route length): even a genuinely
 * multi-destination trip always produces a 3+-element `recommended_route` (pickup + stops +
 * dropoff), so route length alone can't distinguish "nothing noteworthy" from "here's a real
 * rest-time/backtracking consideration" -- a warning is what actually means the evaluator
 * found something worth explaining, not just restating the obvious default order. `warnings`
 * entries are themselves already human-readable (12-recommendation-rules.json's own
 * `recommendation` text, e.g. "Route may be possible but guest rest time is reduced..."), safe
 * to show directly -- unlike this function's own two callers below, this has NO meta-instruction
 * text mixed in, so it's safe to use verbatim in a reply that is NOT LLM-composed (a static
 * template), not just as LLM grounding.
 */
function scenarioFacts(evaluation: ScenarioEvaluation): string[] | null {
  if (evaluation.warnings.length === 0) return null
  const lines: string[] = []
  if (evaluation.recommended_route.length > 2) {
    lines.push(`Recommended route order based on real travel-time/rest-time data: ${evaluation.recommended_route.join(' -> ')}.`)
  }
  lines.push(...evaluation.warnings)
  return lines
}

/**
 * Translates a `ScenarioEvaluation` into a short, LLM-facing note -- adds a meta-instruction
 * telling the LLM to explain the reasoning, not just state the order. Do NOT use this for a
 * reply that isn't LLM-composed (e.g. a static template) -- the instruction text would leak to
 * the customer verbatim; use `describeScenarioForCustomer` there instead.
 */
export function describeScenarioForLLM(evaluation: ScenarioEvaluation): string | null {
  const lines = scenarioFacts(evaluation)
  if (!lines) return null
  // Reported live 2026-08-06: when the SAME message also asked something more direct (e.g.
  // "...mau ke Bromo dan Ijen, berapa harganya?"), the LLM sometimes answered only the price
  // and dropped this note entirely, even though it was present in the prompt -- a soft
  // instruction lost out to the more explicit "answer the price" signal in the customer's own
  // words. Worded as a hard requirement (briefly, alongside whatever else was asked) rather
  // than a conditional "if relevant", since a real rest-time consideration is always relevant
  // once the evaluator has found one -- it should never be silently dropped in favor of
  // answering only the rest of the question.
  return `${lines.join(' ')} Always mention this recommendation and its reasoning (e.g. limited rest time before an early-morning hike) in your reply, even briefly -- alongside whatever else the customer asked (price, packages, etc). Do not drop it in favor of answering only the other part of their question.`
}

/**
 * Translates a `ScenarioEvaluation` into plain, customer-ready text -- for use in a reply that
 * is NOT LLM-composed (e.g. the trip-preferences funnel gate's own static template), where
 * `describeScenarioForLLM`'s meta-instruction suffix would otherwise leak to the customer
 * verbatim.
 */
export function describeScenarioForCustomer(evaluation: ScenarioEvaluation): string | null {
  const lines = scenarioFacts(evaluation)
  return lines ? lines.join(' ') : null
}

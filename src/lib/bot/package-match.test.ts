import { describe, it, expect } from 'vitest'
import {
  matchDestination,
  packagesForDestination,
  pickPackage,
  listDestinations,
  parseTripPreferences,
  priceForPax,
  mentionedDestinationTokens,
  mentionedUnsupportedOriginCity,
  narrowPackagePool,
  sortByBestPackagePriority,
} from './package-match'
import type { Catalog, CatalogPackage } from './types'

function pkg(overrides: Partial<CatalogPackage> = {}): CatalogPackage {
  return {
    packageKey: 'ijen-1d',
    destinationTokens: ['ijen'],
    title: 'Ijen Blue Fire 1D',
    priceIdr: 850000,
    inclusions: [],
    policyNotes: [],
    stagingNotes: [],
    links: {},
    origin: null,
    dayCount: null,
    finishCities: [],
    priceTiers: [],
    ...overrides,
  }
}

function catalogOf(packages: CatalogPackage[]): Catalog {
  return { syncedAt: null, packages }
}

const catalog = catalogOf([pkg()])

describe('matchDestination', () => {
  it('returns null when no known destination is mentioned', () => {
    expect(matchDestination('Halo', catalog)).toBeNull()
  })

  it('matches a known destination token', () => {
    const result = matchDestination('Saya mau ke Ijen dong', catalog)
    expect(result?.destination).toBe('ijen')
    expect(result?.matches.map((p) => p.packageKey)).toEqual(['ijen-1d'])
  })

  it('is case-insensitive when matching destination', () => {
    expect(matchDestination('saya mau ke ijen', catalog)?.destination).toBe('ijen')
  })

  it('returns null when the destination is not recognized', () => {
    expect(matchDestination('Saya mau ke Mars', catalog)).toBeNull()
  })

  it('lists every matching package when more than one package shares a destination', () => {
    const multi = catalogOf([
      pkg({ packageKey: 'ijen-1d', title: 'Ijen Blue Fire 1D' }),
      pkg({ packageKey: 'ijen-2d', title: 'Ijen Blue Fire 2D1N', priceIdr: 1550000 }),
    ])
    const result = matchDestination('Ijen please', multi)
    expect(result?.matches.map((p) => p.title)).toEqual(['Ijen Blue Fire 1D', 'Ijen Blue Fire 2D1N'])
  })

  it('picks only the earliest-mentioned destination when a message names more than one', () => {
    const multiDest = catalogOf([
      pkg({ packageKey: 'bromo-1d', destinationTokens: ['bromo'], title: 'Bromo Midnight 1D', priceIdr: 1000000 }),
      pkg({ packageKey: 'ijen-1d', destinationTokens: ['ijen'], title: 'Ijen Blue Fire 1D' }),
    ])
    const result = matchDestination('Bromo dulu baru Ijen', multiDest)
    expect(result?.destination).toBe('bromo')
    expect(result?.matches.map((p) => p.title)).toEqual(['Bromo Midnight 1D'])
  })

  it('matches a multi-destination package on any of its tokens', () => {
    const combined = catalogOf([
      pkg({ packageKey: 'bali/bromo-ijen-3d2n', destinationTokens: ['bromo', 'ijen'], title: 'Bromo & Ijen 3D2N' }),
    ])
    const viaIjen = matchDestination('tertarik ke ijen', combined)
    expect(viaIjen?.destination).toBe('ijen')
    expect(viaIjen?.matches[0].title).toBe('Bromo & Ijen 3D2N')

    const viaBromo = matchDestination('tertarik ke bromo', combined)
    expect(viaBromo?.destination).toBe('bromo')
    expect(viaBromo?.matches[0].title).toBe('Bromo & Ijen 3D2N')
  })

  it('matches a multi-word destination token', () => {
    const multiWord = catalogOf([pkg({ destinationTokens: ['tumpak sewu'], title: 'Tumpak Sewu 2D1N' })])
    const result = matchDestination('mau ke tumpak sewu waterfall', multiWord)
    expect(result?.destination).toBe('tumpak sewu')
  })

  // Reported live 2026-08-06: a real customer's fully-specified itinerary+price question,
  // written entirely in Chinese ("...第二天去婆罗摩,第三天布罗莫,第四天伊真,送到码头..."), matched
  // nothing at all -- pure Latin-script token matching. Limited to the exact geographic names
  // observed in that real message plus the one unambiguous standard term for Bali.
  it('matches known Chinese aliases for a destination', () => {
    const bromoIjen = catalogOf([
      pkg({ packageKey: 'bromo-1d', destinationTokens: ['bromo'], title: 'Bromo Midnight 1D', priceIdr: 1000000 }),
      pkg({ packageKey: 'ijen-1d', destinationTokens: ['ijen'], title: 'Ijen Blue Fire 1D' }),
    ])
    expect(matchDestination('第二天去婆罗摩看日出', bromoIjen)?.destination).toBe('bromo')
    expect(matchDestination('第三天布罗莫', bromoIjen)?.destination).toBe('bromo')
    expect(matchDestination('第四天伊真', bromoIjen)?.destination).toBe('ijen')
  })
})

describe('packagesForDestination', () => {
  it('finds every package covering a known destination, case-insensitively', () => {
    const multi = catalogOf([
      pkg({ packageKey: 'ijen-1d' }),
      pkg({ packageKey: 'ijen-2d', title: 'Ijen Blue Fire 2D1N' }),
      pkg({ packageKey: 'bromo-1d', destinationTokens: ['bromo'], title: 'Bromo Midnight' }),
    ])
    expect(packagesForDestination('IJEN', multi).map((p) => p.packageKey)).toEqual(['ijen-1d', 'ijen-2d'])
  })

  it('returns an empty array for an unrecognized destination', () => {
    expect(packagesForDestination('mars', catalog)).toEqual([])
  })
})

describe('listDestinations', () => {
  it('title-cases every distinct destination token for a customer-facing message', () => {
    const multi = catalogOf([
      pkg({ destinationTokens: ['bromo', 'ijen'] }),
      pkg({ packageKey: 'ts-2d', destinationTokens: ['tumpak sewu'], title: 'Tumpak Sewu 2D1N' }),
    ])
    expect(listDestinations(multi)).toEqual(['Bromo', 'Ijen', 'Tumpak Sewu'])
  })

  it('dedupes a token shared by multiple packages', () => {
    const multi = catalogOf([
      pkg({ packageKey: 'ijen-1d', destinationTokens: ['ijen'] }),
      pkg({ packageKey: 'ijen-2d', destinationTokens: ['ijen'] }),
    ])
    expect(listDestinations(multi)).toEqual(['Ijen'])
  })
})

describe('pickPackage', () => {
  it('prefers a priced package over an unpriced one', () => {
    const unpriced = pkg({ packageKey: 'ijen-unpriced', priceIdr: null })
    const priced = pkg({ packageKey: 'ijen-priced', priceIdr: 500000 })
    expect(pickPackage([unpriced, priced]).packageKey).toBe('ijen-priced')
  })

  it('falls back to the first match when none are priced', () => {
    const a = pkg({ packageKey: 'a', priceIdr: null })
    const b = pkg({ packageKey: 'b', priceIdr: null })
    expect(pickPackage([a, b]).packageKey).toBe('a')
  })

  const threeDayFromBali = pkg({ packageKey: 'bali-3d', origin: 'Bali', dayCount: 3 })
  const fourDayFromBali = pkg({ packageKey: 'bali-4d', origin: 'Bali', dayCount: 4 })
  const threeDayFromSurabaya = pkg({ packageKey: 'surabaya-3d', origin: 'Surabaya', dayCount: 3 })
  const twoDayFromSurabaya = pkg({ packageKey: 'surabaya-2d', origin: 'Surabaya', dayCount: 2 })
  const allOptions = [threeDayFromBali, fourDayFromBali, threeDayFromSurabaya, twoDayFromSurabaya]

  it('picks the package matching both a stated origin and day count', () => {
    expect(pickPackage(allOptions, { origin: 'Surabaya', dayCount: 3, finishCity: null, pax: null }).packageKey).toBe('surabaya-3d')
    expect(pickPackage(allOptions, { origin: 'Bali', dayCount: 4, finishCity: null, pax: null }).packageKey).toBe('bali-4d')
  })

  it('falls back to matching origin alone when no package matches both', () => {
    expect(pickPackage(allOptions, { origin: 'Bali', dayCount: 2, finishCity: null, pax: null }).packageKey).toBe('bali-3d')
  })

  it('falls back to matching day count alone when origin alone matches nothing', () => {
    const noSurabaya = [threeDayFromBali, fourDayFromBali]
    expect(pickPackage(noSurabaya, { origin: 'Surabaya', dayCount: 4, finishCity: null, pax: null }).packageKey).toBe('bali-4d')
  })

  it('falls back to plain price-only selection when preferences match nothing at all', () => {
    expect(pickPackage(allOptions, { origin: 'Jakarta', dayCount: 9, finishCity: null, pax: null }).packageKey).toBe('bali-3d')
  })

  it('ignores preferences entirely when none are given (default parameter)', () => {
    expect(pickPackage(allOptions).packageKey).toBe('bali-3d')
  })

  // Reported 2026-08-05: "can we finish the trip in Bali?" was answered from a Bali-ORIGIN
  // package, which per real endpoint-chain data does NOT finish in Bali at all -- origin and
  // finish city are genuinely different things.
  describe('finish-city narrowing', () => {
    const bringsBackToBali = pkg({ packageKey: 'finishes-bali', origin: 'Surabaya', finishCities: ['bali', 'surabaya'] })
    const surabayaOnly = pkg({ packageKey: 'finishes-surabaya', origin: 'Bali', finishCities: ['surabaya', 'malang'] })
    const options = [surabayaOnly, bringsBackToBali]

    it('picks the package that can actually finish in the requested city, regardless of origin', () => {
      expect(pickPackage(options, { origin: null, dayCount: null, finishCity: 'bali', pax: null }).packageKey).toBe('finishes-bali')
    })

    it('never picks a package based on origin alone when a finish city is requested and available', () => {
      // surabayaOnly is Bali-ORIGIN but cannot finish in Bali -- must not be picked here.
      const result = pickPackage(options, { origin: 'Bali', dayCount: null, finishCity: 'bali', pax: null })
      expect(result.packageKey).toBe('finishes-bali')
    })

    it('falls back to price-only selection when no package can finish in the requested city', () => {
      expect(pickPackage(options, { origin: null, dayCount: null, finishCity: 'ketapang', pax: null }).packageKey).toBe('finishes-surabaya')
    })
  })
})

describe('parseTripPreferences', () => {
  it('parses an explicit day count ("3 days")', () => {
    expect(parseTripPreferences('I want a 3 day trip').dayCount).toBe(3)
    expect(parseTripPreferences('a 1 day trip please').dayCount).toBe(1)
    expect(parseTripPreferences('mau trip 4 hari')['dayCount']).toBe(4)
  })

  it('parses an "NdMn" duration shorthand', () => {
    expect(parseTripPreferences('the 3d2n package please').dayCount).toBe(3)
    expect(parseTripPreferences('interested in 5D4N').dayCount).toBe(5)
  })

  it('parses an inclusive date range as a day count', () => {
    expect(parseTripPreferences('10-12 June works for us').dayCount).toBe(3)
    expect(parseTripPreferences('June 10-12').dayCount).toBeNull() // month-first phrasing not (yet) supported
  })

  it('parses an origin city', () => {
    expect(parseTripPreferences('starting from Surabaya').origin).toBe('Surabaya')
    expect(parseTripPreferences('departing from Bali').origin).toBe('Bali')
  })

  it('parses an origin city from a known Chinese alias', () => {
    expect(parseTripPreferences('泗水接机').origin).toBe('Surabaya')
    expect(parseTripPreferences('从巴厘岛出发').origin).toBe('Bali')
  })

  it('returns null for all fields when nothing is stated', () => {
    expect(parseTripPreferences('is ijen safe?')).toEqual({ origin: null, dayCount: null, finishCity: null, pax: null })
  })

  it('never invents an unreasonable day count from an unrelated number pair', () => {
    expect(parseTripPreferences('the price is between 500000-2000000').dayCount).toBeNull()
  })

  // Reported live 2026-08-05: "a 20 day expedition to Ijen" was silently dropped (the old cap
  // was 10), so dayCount stayed null and the request never reached narrowPackagePool's own
  // 'none' tier/handoff -- it just got an ad-hoc LLM hedge instead. An EXPLICIT "N day(s)"
  // mention is unambiguous (the customer said the number right next to the unit), so it's now
  // trusted up to 30, well beyond JVTO's real 6-day catalog max, specifically so it reaches
  // the tiered fallback logic instead of being parsed away before ever getting there.
  it('parses an explicit day count beyond the real catalog max, up to 30, so it can reach the tiered fallback/handoff logic', () => {
    expect(parseTripPreferences('a 20 day expedition to Ijen').dayCount).toBe(20)
    expect(parseTripPreferences('we want a 30-day trip').dayCount).toBe(30)
  })

  it('still rejects an explicit day count beyond 30 as unreasonable', () => {
    expect(parseTripPreferences('a 45 day trip please').dayCount).toBeNull()
  })

  // The weaker date-range-IMPLIES-duration heuristic (nothing actually says "N days") keeps
  // its original, tighter cap of 10 -- a garbled or unrelated number pair misread as a date
  // range is a real risk this heuristic never had explicit wording to rule out.
  it('keeps the date-range-implied duration heuristic capped at 10, unlike the explicit "N day(s)" pattern', () => {
    expect(parseTripPreferences('10-25 June works for us').dayCount).toBeNull()
  })

  // Reported 2026-08-05: "a 3-day, 2-night tour" (hyphenated, no space before "day") lost the
  // stated duration entirely, since the regex only allowed whitespace between the number and
  // the unit -- the recommendation list then fell back to showing every duration.
  it('parses a hyphenated day count ("3-day")', () => {
    expect(parseTripPreferences('a 3-day, 2-night tour please').dayCount).toBe(3)
    expect(parseTripPreferences('the 4-day expedition').dayCount).toBe(4)
  })

  // Reported 2026-08-05: "I would like to be picked up in Bali... I have a flight from
  // Surabaya Airport" was parsed as origin='Surabaya' -- the bare city-name fallback checks
  // 'surabaya' before 'bali' with no regard for which city the customer actually named as
  // their PICKUP point vs. one mentioned only incidentally (their departure airport).
  it('treats "picked up in <city>" as the origin, even when the other city is also mentioned', () => {
    expect(
      parseTripPreferences('picked up in Bali on the morning of the 15th, flight from Surabaya Airport on the 17th').origin
    ).toBe('Bali')
    expect(parseTripPreferences('pickup at Surabaya please, our flight home is via Bali').origin).toBe('Surabaya')
  })

  // Reported 2026-08-05: "can we finish the trip in Bali?" was parsed as origin='Bali' (the
  // bare city-name fallback), not as a question about the FINISH city -- a Bali-origin package
  // does not necessarily finish in Bali at all (see catalog.ts's finishCities).
  describe('finish-city phrasing does not get mistaken for origin', () => {
    it('parses "finish in <city>" as finishCity, not origin', () => {
      expect(parseTripPreferences('can we finish the trip in bali?')).toEqual({ origin: null, dayCount: null, finishCity: 'bali', pax: null })
    })

    it('parses "end in <city>" / "drop off in <city>" as finishCity too', () => {
      expect(parseTripPreferences('does it end in Surabaya?').finishCity).toBe('surabaya')
      expect(parseTripPreferences('can you drop off in Malang?').finishCity).toBe('malang')
    })

    // Reported live 2026-08-06: "pickup from Yogyakarta... ending at Surabaya Airport" was
    // parsed as origin='Surabaya' -- 'ending at' wasn't in FINISH_CONTEXT_PHRASES (only
    // 'ending in' was), so the bare-city fallback picked up "Surabaya" with no suppression.
    it('parses "ending at <city>" as finishCity, not origin', () => {
      const result = parseTripPreferences('ending at Surabaya Airport on the last day')
      expect(result.finishCity).toBe('surabaya')
      expect(result.origin).toBeNull()
    })

    it('an explicit "from <city>" still wins as origin even when finish-context phrasing is also present', () => {
      const result = parseTripPreferences('3 day trip from Surabaya, finishing in Bali')
      expect(result.origin).toBe('Surabaya')
      expect(result.finishCity).toBe('bali')
    })

    it('a bare city mention with no finish-context phrasing is still parsed as origin, unchanged', () => {
      expect(parseTripPreferences('I want to go to Ijen from Bali').origin).toBe('Bali')
      expect(parseTripPreferences('a trip to Bali please').origin).toBe('Bali')
    })

    // Reported 2026-08-05: burst-batched customer messages get concatenated into one string
    // before parsing (inbound.ts's debounce/batching), so a real conversation read "...we will
    // be arriving at Surabaya the 14th... So we can be back in Bali the 16th right?" as ONE
    // combined string. The old check suppressed origin for the WHOLE message the instant "back
    // in" appeared anywhere in it, discarding "Surabaya" even though it's in an entirely
    // different, unrelated sentence. Origin/finish-context suppression must be scoped to
    // whichever city is actually near the finish phrase, not the message as a whole.
    it('a finish-context phrase far away in the same (burst-batched) message does not suppress an unrelated earlier city mention', () => {
      const combined =
        "Hi JVTO, I'm interested in booking a private tour to Bromo & Ijen. Can you share options and pricing? " +
        'I have a question we will be arriving at Surabaya the 14th, landing at 15h, can i book the 3D2N trip ' +
        'strating the 14th ? So we can be back in Bali the 16th right ? We will be 2 people, ok perfect, when ' +
        'and where will the medical visit take place?'
      const result = parseTripPreferences(combined)
      expect(result.origin).toBe('Surabaya')
      expect(result.dayCount).toBe(3)
    })
  })

  // Reported 2026-08-05: cross-checked against a real operator-exported pricing sheet, which
  // surfaced that the bot always quoted the cheapest (11+ pax) tier regardless of the
  // customer's actual group size -- nothing had ever parsed how many people were traveling.
  describe('parses a stated group size (pax)', () => {
    it('parses an explicit count with a group-size unit', () => {
      expect(parseTripPreferences('we will be 2 people').pax).toBe(2)
      expect(parseTripPreferences('4 pax please').pax).toBe(4)
      expect(parseTripPreferences('booking for 6 persons').pax).toBe(6)
      expect(parseTripPreferences('a group of 15 travelers').pax).toBe(15)
    })

    it('parses "party of N" / "group of N"', () => {
      expect(parseTripPreferences('a party of 6').pax).toBe(6)
      expect(parseTripPreferences('we are a group of 15').pax).toBe(15)
    })

    it('parses "N of us"', () => {
      expect(parseTripPreferences('3 of us are coming').pax).toBe(3)
    })

    it('parses solo-traveler phrasing as 1', () => {
      expect(parseTripPreferences("I'm traveling solo").pax).toBe(1)
      expect(parseTripPreferences('just me for this trip').pax).toBe(1)
      expect(parseTripPreferences('it will be myself only').pax).toBe(1)
    })

    it('returns null when no group size is stated', () => {
      expect(parseTripPreferences('is ijen safe?').pax).toBeNull()
    })

    it('never invents an unreasonable group size from an unrelated large number', () => {
      expect(parseTripPreferences('our budget is 500 pax').pax).toBeNull()
    })
  })
})

describe('priceForPax', () => {
  const tieredPkg = pkg({
    priceIdr: 2850000,
    priceTiers: [
      { minPax: 2, maxPax: 2, priceIdr: 4050000 },
      { minPax: 3, maxPax: 3, priceIdr: 3800000 },
      { minPax: 4, maxPax: 5, priceIdr: 3550000 },
      { minPax: 6, maxPax: 7, priceIdr: 3350000 },
      { minPax: 8, maxPax: 10, priceIdr: 3050000 },
      { minPax: 11, maxPax: null, priceIdr: 2850000 },
    ],
  })

  it('resolves the exact tier price for a known pax count, including an open-ended top tier', () => {
    expect(priceForPax(tieredPkg, 2)).toEqual({ priceIdr: 4050000, isExactMatch: true })
    expect(priceForPax(tieredPkg, 5)).toEqual({ priceIdr: 3550000, isExactMatch: true })
    expect(priceForPax(tieredPkg, 20)).toEqual({ priceIdr: 2850000, isExactMatch: true })
  })

  it('falls back to the "starting from" priceIdr when pax is unknown', () => {
    expect(priceForPax(tieredPkg, null)).toEqual({ priceIdr: 2850000, isExactMatch: false })
  })

  // Reported 2026-08-05: a solo traveler asking about a package whose real minimum group size
  // is 2 (e.g. bali/bromo-ijen-3d2n's real tiers) has no 1-pax tier at all -- must fall back
  // honestly to the "starting from" price rather than silently returning null or crashing.
  it('falls back to the "starting from" priceIdr when pax has no matching tier (e.g. below the minimum)', () => {
    expect(priceForPax(tieredPkg, 1)).toEqual({ priceIdr: 2850000, isExactMatch: false })
  })

  it('falls back to the "starting from" priceIdr (null) for a package with no tiers at all', () => {
    expect(priceForPax(pkg({ priceIdr: null, priceTiers: [] }), 4)).toEqual({ priceIdr: null, isExactMatch: false })
  })
})

describe('mentionedDestinationTokens', () => {
  const multiDestCatalog = catalogOf([
    pkg({ packageKey: 'a', destinationTokens: ['bromo', 'ijen'] }),
    pkg({ packageKey: 'b', destinationTokens: ['tumpak sewu'] }),
  ])

  it('returns every destination token mentioned, not just the first', () => {
    expect(mentionedDestinationTokens('we want to see Bromo and Ijen', multiDestCatalog).sort()).toEqual(['bromo', 'ijen'])
  })

  it('returns an empty array when no known destination is mentioned', () => {
    expect(mentionedDestinationTokens('how much does it cost?', multiDestCatalog)).toEqual([])
  })

  it('is case-insensitive', () => {
    expect(mentionedDestinationTokens('IJEN please', multiDestCatalog)).toEqual(['ijen'])
  })
})

describe('sortByBestPackagePriority', () => {
  it('moves the 4 confirmed best packages to the front, in their own priority order', () => {
    const other = pkg({ packageKey: 'bromo-1d1n', title: 'Bromo 1D' })
    const best2 = pkg({ packageKey: 'ijen-bromo-madakaripura-3d2n', title: 'Best #2' })
    const best1 = pkg({ packageKey: 'bromo-madakaripura-ijen-3d2n', title: 'Best #1' })
    const result = sortByBestPackagePriority([other, best2, best1])
    expect(result.map((p) => p.packageKey)).toEqual(['bromo-madakaripura-ijen-3d2n', 'ijen-bromo-madakaripura-3d2n', 'bromo-1d1n'])
  })

  it('keeps the relative order of non-best packages unchanged', () => {
    const a = pkg({ packageKey: 'a' })
    const b = pkg({ packageKey: 'b' })
    const c = pkg({ packageKey: 'c' })
    expect(sortByBestPackagePriority([a, b, c]).map((p) => p.packageKey)).toEqual(['a', 'b', 'c'])
  })

  it('does not reorder anything when no best package is present', () => {
    const list = [pkg({ packageKey: 'x' }), pkg({ packageKey: 'y' })]
    expect(sortByBestPackagePriority(list)).toEqual(list)
  })
})

// Confirmed with the operator 2026-08-05: before showing package options, try progressively
// looser tiers in explicit priority order, rather than silently dropping the customer's
// duration or finish city to keep something else.
describe('narrowPackagePool', () => {
  // Fixture mirrors the user's own example: "3 day Surabaya -> Bromo -> Ijen -> Surabaya"
  // doesn't exist as its own package, but "3 day Surabaya -> Ijen -> Bromo -> Surabaya" does
  // (same start/end/duration, different route/order -- route order itself isn't modeled, only
  // which destinations are covered, so this is simulated as a package that simply doesn't
  // cover one of the two requested destinations).
  const bromoOnly3d = pkg({ packageKey: 'bromo-only-3d', destinationTokens: ['bromo'], origin: 'Surabaya', dayCount: 3, finishCities: ['surabaya'] })
  const bromoIjen3d = pkg({ packageKey: 'bromo-ijen-3d', destinationTokens: ['bromo', 'ijen'], origin: 'Surabaya', dayCount: 3, finishCities: ['surabaya'] })

  it('tier "exact": a package covering every requested destination, with the exact start/finish/duration', () => {
    const result = narrowPackagePool([bromoOnly3d, bromoIjen3d], { origin: 'Surabaya', dayCount: 3, finishCity: 'surabaya', pax: null }, ['bromo', 'ijen'])
    expect(result.tier).toBe('exact')
    expect(result.pool.map((p) => p.packageKey)).toEqual(['bromo-ijen-3d'])
  })

  it('tier "relaxed_route": no package covers every requested destination, but one matches the same start/finish/duration', () => {
    // Only bromoOnly3d exists -- doesn't cover the requested "ijen" too.
    const result = narrowPackagePool([bromoOnly3d], { origin: 'Surabaya', dayCount: 3, finishCity: 'surabaya', pax: null }, ['bromo', 'ijen'])
    expect(result.tier).toBe('relaxed_route')
    expect(result.pool.map((p) => p.packageKey)).toEqual(['bromo-only-3d'])
  })

  // The user's own example: "4 day Bali -> Bali" doesn't exist (no Bali-origin package
  // finishes in Bali) -- offer "4 day Surabaya -> Bali" instead (same finish, different start).
  it('tier "relaxed_start_end": no package satisfies origin+finishCity together, keeps duration and offers the closest start/finish alternative', () => {
    const surabayaToBali4d = pkg({ packageKey: 'surabaya-bali-4d', origin: 'Surabaya', dayCount: 4, finishCities: ['bali'] })
    const baliOrigin4d = pkg({ packageKey: 'bali-origin-4d', origin: 'Bali', dayCount: 4, finishCities: ['surabaya'] })
    const result = narrowPackagePool([surabayaToBali4d, baliOrigin4d], { origin: 'Bali', dayCount: 4, finishCity: 'bali', pax: null }, [])
    expect(result.tier).toBe('relaxed_start_end')
    // Keeps the one matching finishCity='bali' (surabayaToBali4d) even though origin differs.
    expect(result.pool.map((p) => p.packageKey)).toContain('surabaya-bali-4d')
  })

  it('tier "none": not even the stated duration has any match for this destination', () => {
    const onlyThreeDay = pkg({ packageKey: 'only-3d', origin: 'Surabaya', dayCount: 3, finishCities: ['surabaya'] })
    const result = narrowPackagePool([onlyThreeDay], { origin: 'Surabaya', dayCount: 15, finishCity: null, pax: null }, [])
    expect(result.tier).toBe('none')
    expect(result.pool).toEqual([])
  })

  it('treats no requested destinations (a bare recommendation ask) the same as "exact" once start/finish/duration match', () => {
    const result = narrowPackagePool([bromoIjen3d], { origin: 'Surabaya', dayCount: 3, finishCity: 'surabaya', pax: null }, [])
    expect(result.tier).toBe('exact')
  })

  it('falls back gracefully when no preferences are stated at all (returns everything as "exact")', () => {
    const result = narrowPackagePool([bromoOnly3d, bromoIjen3d], { origin: null, dayCount: null, finishCity: null, pax: null }, [])
    expect(result.tier).toBe('exact')
    expect(result.pool.length).toBe(2)
  })
})

describe('mentionedUnsupportedOriginCity', () => {
  // Reported live 2026-08-06: "Start / Pick-up: Yogyakarta... What is the price for 2 people?"
  // was silently mis-parsed instead of the bot ever telling the customer Yogyakarta isn't a
  // supported pickup point (JVTO tours only depart from Surabaya or Bali).
  it('flags an explicit start/pickup city JVTO does not service', () => {
    expect(mentionedUnsupportedOriginCity('Start / Pick-up: Yogyakarta')).toBe('Yogyakarta')
    expect(mentionedUnsupportedOriginCity('pickup from Jakarta please')).toBe('Jakarta')
    expect(mentionedUnsupportedOriginCity('starting in Canggu')).toBe('Canggu')
  })

  it('returns null when a real, supported origin (Bali/Surabaya) is already stated', () => {
    expect(mentionedUnsupportedOriginCity('pickup from Surabaya please')).toBeNull()
  })

  it('returns null when no start-context phrasing is present at all', () => {
    expect(mentionedUnsupportedOriginCity('is ijen safe?')).toBeNull()
  })

  // Malang/Ketapang are real waypoints/finish points elsewhere in a genuine itinerary (e.g.
  // the Ketapang-Gilimanuk ferry) -- flagging them here would produce a FALSE "not supported"
  // claim about a place that genuinely is part of real routes.
  it('does not flag Ketapang, a real route waypoint ("the ferry FROM Ketapang" is common, unrelated phrasing)', () => {
    expect(mentionedUnsupportedOriginCity('the ferry from Ketapang to Gilimanuk')).toBeNull()
  })

  // Reported live 2026-08-06, re-checked after the first pass: 2 real customers (Julia,
  // anthony wijoyo) explicitly asked for pickup FROM Malang -- genuinely unsupported (real
  // package origins are only ever Bali/Surabaya), and unlike Ketapang there's no common
  // innocent "from Malang" phrasing to false-positive on.
  it('flags Malang as an unsupported pickup city when explicitly requested as a start point', () => {
    expect(mentionedUnsupportedOriginCity('starting from Malang')).toBe('Malang')
    expect(mentionedUnsupportedOriginCity('can I get picked up from Malang instead of Surabaya?')).toBe('Malang')
  })

  it('does not flag an ordinary route-leg description mentioning Malang as a waypoint (not a start-context phrase)', () => {
    expect(mentionedUnsupportedOriginCity('Day 3: Bromo Area to Malang, then Malang to Surabaya')).toBeNull()
  })
})

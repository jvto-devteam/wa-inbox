import { describe, it, expect } from 'vitest'
import { matchDestination, packagesForDestination, pickPackage, listDestinations, parseTripPreferences } from './package-match'
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
    expect(pickPackage(allOptions, { origin: 'Surabaya', dayCount: 3, finishCity: null }).packageKey).toBe('surabaya-3d')
    expect(pickPackage(allOptions, { origin: 'Bali', dayCount: 4, finishCity: null }).packageKey).toBe('bali-4d')
  })

  it('falls back to matching origin alone when no package matches both', () => {
    expect(pickPackage(allOptions, { origin: 'Bali', dayCount: 2, finishCity: null }).packageKey).toBe('bali-3d')
  })

  it('falls back to matching day count alone when origin alone matches nothing', () => {
    const noSurabaya = [threeDayFromBali, fourDayFromBali]
    expect(pickPackage(noSurabaya, { origin: 'Surabaya', dayCount: 4, finishCity: null }).packageKey).toBe('bali-4d')
  })

  it('falls back to plain price-only selection when preferences match nothing at all', () => {
    expect(pickPackage(allOptions, { origin: 'Jakarta', dayCount: 9, finishCity: null }).packageKey).toBe('bali-3d')
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
      expect(pickPackage(options, { origin: null, dayCount: null, finishCity: 'bali' }).packageKey).toBe('finishes-bali')
    })

    it('never picks a package based on origin alone when a finish city is requested and available', () => {
      // surabayaOnly is Bali-ORIGIN but cannot finish in Bali -- must not be picked here.
      const result = pickPackage(options, { origin: 'Bali', dayCount: null, finishCity: 'bali' })
      expect(result.packageKey).toBe('finishes-bali')
    })

    it('falls back to price-only selection when no package can finish in the requested city', () => {
      expect(pickPackage(options, { origin: null, dayCount: null, finishCity: 'ketapang' }).packageKey).toBe('finishes-surabaya')
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

  it('returns null for all fields when nothing is stated', () => {
    expect(parseTripPreferences('is ijen safe?')).toEqual({ origin: null, dayCount: null, finishCity: null })
  })

  it('never invents an unreasonable day count from an unrelated number pair', () => {
    expect(parseTripPreferences('the price is between 500000-2000000').dayCount).toBeNull()
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
      expect(parseTripPreferences('can we finish the trip in bali?')).toEqual({ origin: null, dayCount: null, finishCity: 'bali' })
    })

    it('parses "end in <city>" / "drop off in <city>" as finishCity too', () => {
      expect(parseTripPreferences('does it end in Surabaya?').finishCity).toBe('surabaya')
      expect(parseTripPreferences('can you drop off in Malang?').finishCity).toBe('malang')
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
  })
})

import { describe, it, expect } from 'vitest'
import { matchDestination, packagesForDestination, pickPackage } from './package-match'
import type { Catalog, CatalogPackage } from './types'

function pkg(overrides: Partial<CatalogPackage> = {}): CatalogPackage {
  return {
    packageKey: 'ijen-1d',
    destinationTokens: ['ijen'],
    title: 'Ijen Blue Fire 1D',
    priceIdr: 850000,
    inclusions: [],
    policyNotes: [],
    links: {},
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
})

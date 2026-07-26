import { describe, it, expect } from 'vitest'
import { checkRouteGate } from './route-gate'
import type { Catalog, CatalogPackage } from './types'

function pkg(overrides: Partial<CatalogPackage> = {}): CatalogPackage {
  return {
    packageKey: 'ijen-1d',
    destination: 'Ijen',
    title: 'Ijen Blue Fire 1D',
    priceIdr: 850000,
    inclusions: [],
    policyNotes: [],
    links: {},
    ...overrides,
  }
}

function catalogOf(packages: CatalogPackage[]): Catalog {
  return { syncedAt: '2026-07-25T00:00:00Z', packages }
}

describe('checkRouteGate', () => {
  it('returns clear for a destination matching a priced package with no caveats', () => {
    const catalog = catalogOf([pkg()])
    expect(checkRouteGate({ destination: 'Ijen', catalog })).toEqual({ status: 'clear' })
  })

  it('is case-insensitive when matching destination', () => {
    const catalog = catalogOf([pkg({ destination: 'Ijen' })])
    expect(checkRouteGate({ destination: 'ijen', catalog })).toEqual({ status: 'clear' })
  })

  it('returns handoff when no destination has been extracted yet', () => {
    const catalog = catalogOf([pkg()])
    const result = checkRouteGate({ catalog })
    expect(result.status).toBe('handoff')
  })

  it('returns handoff for a destination with no matching package (unknown route, fail-safe)', () => {
    const catalog = catalogOf([pkg()])
    const result = checkRouteGate({ destination: 'Atlantis', catalog })
    expect(result.status).toBe('handoff')
  })

  it('returns handoff when every matching package has no synced price (route gap: no facts to quote)', () => {
    const catalog = catalogOf([pkg({ priceIdr: null })])
    const result = checkRouteGate({ destination: 'Ijen', catalog })
    expect(result.status).toBe('handoff')
  })

  it('returns needs_review when a priced matching package carries policy notes (disclosure required)', () => {
    const catalog = catalogOf([
      pkg({ policyNotes: ['Subject to weather conditions at crater'] }),
    ])
    const result = checkRouteGate({ destination: 'Ijen', catalog })
    expect(result.status).toBe('needs_review')
    if (result.status === 'needs_review') {
      expect(result.reason).toContain('Ijen')
    }
  })

  it('prefers a priced match over an unpriced match for the same destination', () => {
    const catalog = catalogOf([
      pkg({ packageKey: 'ijen-1d', priceIdr: null }),
      pkg({ packageKey: 'ijen-2d', priceIdr: 1200000 }),
    ])
    const result = checkRouteGate({ destination: 'Ijen', catalog })
    expect(result.status).toBe('clear')
  })

  it('flags needs_review if any priced match among several has policy notes', () => {
    const catalog = catalogOf([
      pkg({ packageKey: 'ijen-1d', priceIdr: 850000, policyNotes: [] }),
      pkg({ packageKey: 'ijen-2d', priceIdr: 1200000, policyNotes: ['Requires 24h reconfirmation'] }),
    ])
    const result = checkRouteGate({ destination: 'Ijen', catalog })
    expect(result.status).toBe('needs_review')
  })

  it('returns a descriptive reason on handoff for an unrecognized destination', () => {
    const catalog = catalogOf([pkg()])
    const result = checkRouteGate({ destination: 'Atlantis', catalog })
    if (result.status === 'handoff') {
      expect(result.reason).toContain('Atlantis')
    }
  })
})

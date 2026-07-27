import { describe, it, expect } from 'vitest'
import { processFunnelState } from './funnel'
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

describe('processFunnelState', () => {
  it('moves from GREETING to TANYA_ORIGIN on first contact when no destination is mentioned', () => {
    const result = processFunnelState({ currentState: 'GREETING', message: 'Halo', catalog })
    expect(result.nextState).toBe('TANYA_ORIGIN')
  })

  it('greedily jumps GREETING straight to REKOMENDASI when a known destination is already named (matches orderFlow.js\'s "advance immediately" shortcut)', () => {
    const result = processFunnelState({ currentState: 'GREETING', message: 'Saya mau ke Ijen dong', catalog })
    expect(result.nextState).toBe('REKOMENDASI')
    expect(result.reply).toContain('Ijen Blue Fire 1D')
  })

  it('moves from TANYA_ORIGIN to REKOMENDASI when a known destination is mentioned', () => {
    const result = processFunnelState({ currentState: 'TANYA_ORIGIN', message: 'Saya mau ke Ijen', catalog })
    expect(result.nextState).toBe('REKOMENDASI')
    expect(result.reply).toContain('Ijen Blue Fire 1D')
  })

  it('is case-insensitive when matching destination', () => {
    const result = processFunnelState({ currentState: 'TANYA_ORIGIN', message: 'saya mau ke ijen', catalog })
    expect(result.nextState).toBe('REKOMENDASI')
  })

  it('stays in TANYA_ORIGIN when the destination is not recognized', () => {
    const result = processFunnelState({ currentState: 'TANYA_ORIGIN', message: 'Saya mau ke Mars', catalog })
    expect(result.nextState).toBe('TANYA_ORIGIN')
  })

  it('lists every matching package when more than one package shares a destination', () => {
    const multi = catalogOf([
      pkg({ packageKey: 'ijen-1d', title: 'Ijen Blue Fire 1D' }),
      pkg({ packageKey: 'ijen-2d', title: 'Ijen Blue Fire 2D1N', priceIdr: 1550000 }),
    ])
    const result = processFunnelState({ currentState: 'TANYA_ORIGIN', message: 'Ijen please', catalog: multi })
    expect(result.reply).toContain('Ijen Blue Fire 1D')
    expect(result.reply).toContain('Ijen Blue Fire 2D1N')
  })

  it('picks only the earliest-mentioned destination when a message names more than one (no mixed-destination reply)', () => {
    const multiDest = catalogOf([
      pkg({ packageKey: 'bromo-1d', destinationTokens: ['bromo'], title: 'Bromo Midnight 1D', priceIdr: 1000000 }),
      pkg({ packageKey: 'ijen-1d', destinationTokens: ['ijen'], title: 'Ijen Blue Fire 1D' }),
    ])
    const result = processFunnelState({ currentState: 'TANYA_ORIGIN', message: 'Bromo dulu baru Ijen', catalog: multiDest })
    expect(result.reply).toContain('Bromo Midnight 1D')
    expect(result.reply).not.toContain('Ijen Blue Fire 1D')
  })

  it('stays in REKOMENDASI on any follow-up message instead of auto-escalating to HUMAN_HANDOFF (real orderFlow.js: "Stay — LLM handles all follow-up questions")', () => {
    const result = processFunnelState({ currentState: 'REKOMENDASI', message: 'Ya, saya mau lanjut booking', catalog })
    expect(result.nextState).toBe('REKOMENDASI')
    expect(result.nextState).not.toBe('HUMAN_HANDOFF')
  })

  it('HUMAN_HANDOFF is a sink state that never advances on its own', () => {
    const result = processFunnelState({ currentState: 'HUMAN_HANDOFF', message: 'halo?', catalog })
    expect(result.nextState).toBe('HUMAN_HANDOFF')
    expect(result.reply).toContain('team')
  })

  // --- Fix Wave 3b ---

  // I2: the matched destination used to be computed here and thrown away, so
  // `tripBrief.destination` was never written by anything and route-gate.ts handed
  // off on every message ("Tujuan belum diketahui") forever.
  it('reports the matched destination so the caller can persist it into tripBrief', () => {
    const result = processFunnelState({ currentState: 'GREETING', message: 'Saya mau ke Ijen dong', catalog })
    expect(result.destination).toBe('ijen')
  })

  it('reports no destination when nothing matched, so a persisted one is never overwritten', () => {
    const result = processFunnelState({ currentState: 'TANYA_ORIGIN', message: 'Saya mau ke Mars', catalog })
    expect(result.destination).toBeUndefined()
  })

  // I1: all 16 real packages are multi-destination overland tours.
  it('matches a multi-destination package on any of its tokens and lists it under that destination', () => {
    const combined = catalogOf([
      pkg({ packageKey: 'bali/bromo-ijen-3d2n', destinationTokens: ['bromo', 'ijen'], title: 'Bromo & Ijen 3D2N' }),
    ])
    const viaIjen = processFunnelState({ currentState: 'TANYA_ORIGIN', message: 'tertarik ke ijen', catalog: combined })
    expect(viaIjen.destination).toBe('ijen')
    expect(viaIjen.reply).toContain('Bromo & Ijen 3D2N')

    const viaBromo = processFunnelState({ currentState: 'TANYA_ORIGIN', message: 'tertarik ke bromo', catalog: combined })
    expect(viaBromo.destination).toBe('bromo')
    expect(viaBromo.reply).toContain('Bromo & Ijen 3D2N')
  })

  it('matches a multi-word destination token and title-cases it for display', () => {
    const multiWord = catalogOf([pkg({ destinationTokens: ['tumpak sewu'], title: 'Tumpak Sewu 2D1N' })])
    const result = processFunnelState({ currentState: 'TANYA_ORIGIN', message: 'mau ke tumpak sewu waterfall', catalog: multiWord })
    expect(result.destination).toBe('tumpak sewu')
    expect(result.reply).toContain('*Tumpak Sewu*')
  })

  // I3: route-gate.ts turns a package with policyNotes into `needs_review` -- "show
  // the price, but with the disclosure". Wave 3a left that middle state with no
  // consumer, so the disclosure was silently dropped; the recommendation reply is
  // where it is surfaced now.
  it('appends package-scoped policy notes as a visible disclosure instead of dropping them', () => {
    const withPolicy = catalogOf([
      pkg({ policyNotes: ['Ijen Health Screening: a health certificate is mandatory for every guest.'] }),
    ])
    const result = processFunnelState({ currentState: 'TANYA_ORIGIN', message: 'Ijen please', catalog: withPolicy })
    expect(result.reply).toContain('Good to know:')
    expect(result.reply).toContain('• Ijen Health Screening: a health certificate is mandatory for every guest.')
    // The price must still be shown -- `needs_review` is not a handoff.
    expect(result.reply).toContain('from Rp 850.000/person')
  })

  it('dedupes disclosures shared by several listed packages and omits the block entirely when there are none', () => {
    const shared = 'Ijen Monthly Closure: the crater closes on the first Friday of each month.'
    const withShared = catalogOf([
      pkg({ packageKey: 'ijen-1d', policyNotes: [shared] }),
      pkg({ packageKey: 'ijen-2d', title: 'Ijen Blue Fire 2D1N', policyNotes: [shared] }),
    ])
    const result = processFunnelState({ currentState: 'TANYA_ORIGIN', message: 'Ijen please', catalog: withShared })
    expect(result.reply.split(shared)).toHaveLength(2)

    const plain = processFunnelState({ currentState: 'TANYA_ORIGIN', message: 'Ijen please', catalog })
    expect(plain.reply).not.toContain('Good to know:')
  })

  it('falls back to the real generic clarification line for an unrecognized state, leaving state unchanged', () => {
    const result = processFunnelState({ currentState: 'SOME_UNKNOWN_STATE', message: 'huh', catalog })
    expect(result.nextState).toBe('SOME_UNKNOWN_STATE')
    expect(result.reply).toBe("Sorry, I didn't quite catch that. Could you clarify? 😊")
  })
})

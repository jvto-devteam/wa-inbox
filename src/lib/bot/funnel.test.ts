import { describe, it, expect } from 'vitest'
import { processFunnelState } from './funnel'
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
      pkg({ packageKey: 'bromo-1d', destination: 'Bromo', title: 'Bromo Midnight 1D', priceIdr: 1000000 }),
      pkg({ packageKey: 'ijen-1d', destination: 'Ijen', title: 'Ijen Blue Fire 1D' }),
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

  it('falls back to the real generic clarification line for an unrecognized state, leaving state unchanged', () => {
    const result = processFunnelState({ currentState: 'SOME_UNKNOWN_STATE', message: 'huh', catalog })
    expect(result.nextState).toBe('SOME_UNKNOWN_STATE')
    expect(result.reply).toBe("Sorry, I didn't quite catch that. Could you clarify? 😊")
  })
})

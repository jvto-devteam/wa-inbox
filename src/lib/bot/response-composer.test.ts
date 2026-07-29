import { describe, it, expect } from 'vitest'
import { composeResponse, detectTopic } from './response-composer'
import type { Catalog, CatalogPackage } from './types'

function pkg(overrides: Partial<CatalogPackage> = {}): CatalogPackage {
  return {
    packageKey: 'ijen-1d',
    destinationTokens: ['ijen'],
    title: 'Ijen Blue Fire 1D',
    priceIdr: 850000,
    inclusions: ['Guide lokal', 'Transport'],
    policyNotes: ['Tidak bisa refund H-1'],
    links: { booking: 'https://javavolcano-touroperator.com/travel-guide/booking-information' },
    ...overrides,
  }
}

function catalogOf(packages: CatalogPackage[]): Catalog {
  return { syncedAt: '2026-07-25T00:00:00Z', packages }
}

describe('composeResponse', () => {
  // --- core rule under test: price only for a price-relevant topic AND not a handoff ---

  it('includes price when topic is price and not a handoff', () => {
    const catalog = catalogOf([pkg()])
    const text = composeResponse({ topic: 'price', packageKey: 'ijen-1d', catalog, isHandoff: false })
    expect(text).toContain('850.000')
  })

  it('never includes price when topic is inclusions, even when priced and not a handoff', () => {
    const catalog = catalogOf([pkg()])
    const text = composeResponse({ topic: 'inclusions', packageKey: 'ijen-1d', catalog, isHandoff: false })
    expect(text).not.toContain('850.000')
    expect(text).toContain('Guide lokal')
  })

  it('never includes price when topic is policy, even when priced and not a handoff', () => {
    const catalog = catalogOf([pkg()])
    const text = composeResponse({ topic: 'policy', packageKey: 'ijen-1d', catalog, isHandoff: false })
    expect(text).not.toContain('850.000')
  })

  it('never includes price when isHandoff is true, even for the price topic', () => {
    const catalog = catalogOf([pkg()])
    const text = composeResponse({ topic: 'price', packageKey: 'ijen-1d', catalog, isHandoff: true })
    expect(text).not.toContain('850.000')
  })

  // --- real source: PRICE_RELEVANT_TOPICS = {"price", "booking"} (response_composer.py:45).
  // wa-inbox's `how_to_book` is the analog of the real "booking" topic (module_resolver.py:63
  // maps "how do i book" -> topic "booking"; presentation_resolver.py:41 gives it its own
  // "booking_start" mode) -- so a booking question IS price-relevant and must surface price
  // when not a handoff, exactly like the price topic. The brief's placeholder got this wrong.

  it('includes price when topic is how_to_book and not a handoff (booking is price-relevant)', () => {
    const catalog = catalogOf([pkg()])
    const text = composeResponse({ topic: 'how_to_book', packageKey: 'ijen-1d', catalog, isHandoff: false })
    expect(text).toContain('850.000')
    expect(text).toContain('https://javavolcano-touroperator.com/travel-guide/booking-information')
  })

  it('never includes price or the booking link for how_to_book when isHandoff is true', () => {
    // presentation_resolver.py:12 "Never gives a direct booking CTA on a custom-quote case."
    const catalog = catalogOf([pkg()])
    const text = composeResponse({ topic: 'how_to_book', packageKey: 'ijen-1d', catalog, isHandoff: true })
    expect(text).not.toContain('850.000')
    expect(text).not.toContain('booking-information')
  })

  // --- unknown package: response_composer.py docstring line 18, "unknown package -> handoff".
  // catalog_forces_handoff escalates regardless of what the caller's isHandoff signal says.

  it('forces a handoff-style response for an unknown packageKey even when isHandoff is false', () => {
    const catalog = catalogOf([pkg()])
    const text = composeResponse({ topic: 'price', packageKey: 'does-not-exist', catalog, isHandoff: false })
    expect(text).not.toContain('850.000')
    expect(text.length).toBeGreaterThan(0)
  })

  // --- never silently drop the customer: response_composer.py always emits at least one
  // line (title, or the handoff fallback) -- it never returns an empty draft.

  it('never returns an empty string, across topic x handoff combinations', () => {
    const catalog = catalogOf([pkg()])
    const topics = ['inclusions', 'how_to_book', 'policy', 'price'] as const
    for (const topic of topics) {
      for (const isHandoff of [true, false]) {
        const text = composeResponse({ topic, packageKey: 'ijen-1d', catalog, isHandoff })
        expect(text.length).toBeGreaterThan(0)
      }
    }
  })

  it('includes the package title even when isHandoff is true', () => {
    const catalog = catalogOf([pkg()])
    const text = composeResponse({ topic: 'price', packageKey: 'ijen-1d', catalog, isHandoff: true })
    expect(text).toContain('Ijen Blue Fire 1D')
  })

  it('suppresses the topic-scoped fact line (not just price) on handoff', () => {
    // response_composer.py:202-203 -- `if topic_line and not needs_handoff`
    const catalog = catalogOf([pkg()])
    const text = composeResponse({ topic: 'inclusions', packageKey: 'ijen-1d', catalog, isHandoff: true })
    expect(text).not.toContain('Guide lokal')
  })

  // --- price-not-yet-available (priceIdr === null): wa-inbox's single collapsed state for
  // the real system's separate custom_quote_required / unavailable states.

  it('falls back to a confirmation message, not a number, when priceIdr is null', () => {
    const catalog = catalogOf([pkg({ priceIdr: null, title: 'Ijen Blue Package' })])
    const text = composeResponse({ topic: 'price', packageKey: 'ijen-1d', catalog, isHandoff: false })
    expect(text).not.toMatch(/Rp[\d.]/)
  })

  // --- inclusions cap: response_composer.py:129 `inc[:4]` -- never dumps an unbounded list.

  it('caps inclusions at 4 items', () => {
    const catalog = catalogOf([
      pkg({ inclusions: ['Item1', 'Item2', 'Item3', 'Item4', 'Item5', 'Item6'] }),
    ])
    const text = composeResponse({ topic: 'inclusions', packageKey: 'ijen-1d', catalog, isHandoff: false })
    expect(text).toContain('Item1')
    expect(text).toContain('Item4')
    expect(text).not.toContain('Item5')
    expect(text).not.toContain('Item6')
  })

  it('shows policy notes for the policy topic when not a handoff', () => {
    const catalog = catalogOf([pkg()])
    const text = composeResponse({ topic: 'policy', packageKey: 'ijen-1d', catalog, isHandoff: false })
    expect(text).toContain('Tidak bisa refund H-1')
  })
})

describe('detectTopic', () => {
  it('detects how_to_book from booking-style phrasing', () => {
    expect(detectTopic('Bagaimana cara booking paket ini?')).toBe('how_to_book')
    expect(detectTopic('How do I book this tour?')).toBe('how_to_book')
  })

  it('detects policy from policy-style phrasing', () => {
    expect(detectTopic('Apa kebijakan pembatalannya?')).toBe('policy')
  })

  it('detects inclusions from "what is included" phrasing', () => {
    expect(detectTopic('Paket ini termasuk apa saja?')).toBe('inclusions')
    expect(detectTopic('What is included in this package?')).toBe('inclusions')
  })

  it('detects price from price-style phrasing', () => {
    expect(detectTopic('Harganya berapa?')).toBe('price')
    expect(detectTopic('How much does this cost?')).toBe('price')
  })

  it('falls back to inclusions when nothing matches', () => {
    expect(detectTopic('Halo, saya mau tanya paket ke Ijen')).toBe('inclusions')
  })

  it('is case-insensitive', () => {
    expect(detectTopic('BERAPA HARGANYA?')).toBe('price')
  })
})

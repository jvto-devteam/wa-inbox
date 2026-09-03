import { describe, it, expect } from 'vitest'
import { extractRupiahAmounts, extractUrls, verifyReply, buildVerificationRetryInstruction } from './reply-verifier'

describe('extractRupiahAmounts', () => {
  it.each([
    ['Rp4.050.000', 4050000],
    ['Rp 4.050.000/person', 4050000],
    ['IDR 7.500.000', 7500000],
  ])('reads %s', (text, expected) => expect(extractRupiahAmounts(text as string)).toEqual([expected]))

  it('ignores pax counts, day counts and years', () => {
    expect(extractRupiahAmounts('a 3D2N trip for 4 people in 2026')).toEqual([])
  })

  it('does not read the "k" of an ordinary word as a thousands suffix', () => {
    // Found live in watsapin: "Rp3.500 kalau ambil satu" parsed as Rp3.500.000.
    expect(extractRupiahAmounts('Rp150.000 kalau ambil satu')).toEqual([150000])
  })

  it('reads an explicit magnitude suffix on a bare number', () => {
    expect(extractRupiahAmounts('sekitar 1,5 juta per orang')).toEqual([1500000])
  })
})

describe('verifyReply', () => {
  const tiers = [4050000, 7500000]
  const urls = ['https://javavolcano-touroperator.com/tours/from-bali/bromo-ijen-3d2n']

  it('passes a reply quoting a real tier and a real link', () => {
    expect(
      verifyReply({
        replyText: `It's Rp4.050.000/person. Details: ${urls[0]}`,
        groundedAmounts: tiers,
        groundedUrls: urls,
      })
    ).toEqual({ fabricatedPrices: [], unverifiedPrices: [], unknownUrls: [] })
  })

  it('blocks a price when the grounding published none at all', () => {
    const r = verifyReply({ replyText: 'It is Rp2.000.000 per person', groundedAmounts: [], groundedUrls: urls })
    expect(r.fabricatedPrices).toEqual([2000000])
  })

  it('only advises when the grounding did publish prices', () => {
    const r = verifyReply({ replyText: 'It is Rp9.999.999 per person', groundedAmounts: tiers, groundedUrls: urls })
    expect(r.fabricatedPrices).toEqual([])
    expect(r.unverifiedPrices).toEqual([9999999])
  })

  it('accepts a group total derived from a real per-person tier', () => {
    // 2 x Rp4.050.000 -- a legitimate sum the bot is expected to do.
    const r = verifyReply({ replyText: 'For 2 people that is Rp8.100.000 total', groundedAmounts: tiers, groundedUrls: urls })
    expect(r.unverifiedPrices).toEqual([])
  })

  it('blocks a URL that is in no registry', () => {
    const r = verifyReply({
      replyText: 'See https://javavolcano-touroperator.com/tours/made-up-package',
      groundedAmounts: tiers,
      groundedUrls: urls,
    })
    expect(r.unknownUrls).toEqual(['https://javavolcano-touroperator.com/tours/made-up-package'])
  })

  it('strips trailing sentence punctuation from a URL', () => {
    // "See https://example.com/page." -- the full stop is formatting, and
    // treating it as part of the URL would flag a perfectly good link.
    expect(extractUrls('See https://javavolcano-touroperator.com/tours/x.')).toEqual([
      'https://javavolcano-touroperator.com/tours/x',
    ])
  })

  it('accepts a grounded link the model gave a trailing slash', () => {
    const r = verifyReply({ replyText: `Details: ${urls[0]}/`, groundedAmounts: tiers, groundedUrls: urls })
    expect(r.unknownUrls).toEqual([])
  })
})

describe('buildVerificationRetryInstruction', () => {
  it('names both the fabricated prices and the unknown links, and never the merely-unverified ones', () => {
    const instruction = buildVerificationRetryInstruction({
      fabricatedPrices: [2000000],
      unverifiedPrices: [9999999],
      unknownUrls: ['https://javavolcano-touroperator.com/tours/made-up-package'],
    })
    expect(instruction).toContain('Rp2.000.000')
    expect(instruction).toContain('https://javavolcano-touroperator.com/tours/made-up-package')
    // An unverified figure is advisory -- it is still sent, so the retry must
    // never tell the model that a legitimate calculation was fabricated.
    expect(instruction).not.toContain('9.999.999')
  })
})

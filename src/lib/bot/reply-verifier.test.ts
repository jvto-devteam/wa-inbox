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
    ).toEqual({ fabricatedPrices: [], unverifiedPrices: [], unknownUrls: [], guaranteeViolations: [] })
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

describe('verifyReply guarantee violations', () => {
  it('menandai balasan yang menjanjikan Blue Fire', () => {
    const result = verifyReply({ replyText: 'Blue fire is guaranteed in May!', groundedAmounts: [], groundedUrls: [], topic: 'blue_fire' })
    expect(result.guaranteeViolations).toContain('guaranteed')
  })

  it('tidak menandai kata jaminan pada topik yang tidak diatur', () => {
    const result = verifyReply({
      replyText: 'Your booking is guaranteed once the deposit clears.',
      groundedAmounts: [],
      groundedUrls: [],
      topic: 'payment',
    })
    expect(result.guaranteeViolations).toEqual([])
  })

  it('tidak menandai balasan yang justru menyangkal jaminan', () => {
    const result = verifyReply({
      replyText: 'Blue fire cannot be guaranteed — it depends on conditions.',
      groundedAmounts: [],
      groundedUrls: [],
      topic: 'blue_fire',
    })
    expect(result.guaranteeViolations).toEqual([])
  })

  // Ruling R49: reply-verifier owns its OWN reply-side phrase list, deliberately narrower than
  // knowledge.ts's GUARANTEE_PHRASES (which is tuned to detect a customer DEMANDING a guarantee,
  // not to judge a reply -- it includes '100%' and 'certain', which would flag "All tours are
  // 100% PRIVATE" (knowledge.ts's own FAQ first line) and "certain conditions" as violations).
  it('tidak menandai "100% private" pada topik blue_fire', () => {
    const result = verifyReply({
      replyText: 'All tours are 100% PRIVATE, just you and your guide.',
      groundedAmounts: [],
      groundedUrls: [],
      topic: 'blue_fire',
    })
    expect(result.guaranteeViolations).toEqual([])
  })

  it('tidak menandai "certain conditions" pada topik blue_fire', () => {
    const result = verifyReply({
      replyText: 'Blue fire is visible under certain conditions.',
      groundedAmounts: [],
      groundedUrls: [],
      topic: 'blue_fire',
    })
    expect(result.guaranteeViolations).toEqual([])
  })

  it('tidak menandai "isn\'t guaranteed"', () => {
    const result = verifyReply({
      replyText: "Blue fire isn't guaranteed every night.",
      groundedAmounts: [],
      groundedUrls: [],
      topic: 'blue_fire',
    })
    expect(result.guaranteeViolations).toEqual([])
  })

  // Negasi dinilai PER KALIMAT: negasi di kalimat lain tidak boleh menutupi pelanggaran nyata
  // di kalimat ini.
  it('tidak membiarkan negasi di kalimat lain menutupi pelanggaran nyata', () => {
    const result = verifyReply({
      replyText: 'Blue fire is guaranteed! Refunds are not guaranteed.',
      groundedAmounts: [],
      groundedUrls: [],
      topic: 'blue_fire',
    })
    expect(result.guaranteeViolations).toContain('guaranteed')
  })

  // Ruling R70: GUARANTEE_ROOT matches inside a bare URL -- "https://x.id/guarantee.html"
  // contains the substring "guarantee" with word boundaries either side of it (the slash and
  // dot both count as non-word characters), so without stripping URLs first this URL alone was
  // flagged as a violation with no actual promise anywhere in the reply.
  it('tidak menandai URL yang kebetulan memuat kata "guarantee"', () => {
    const result = verifyReply({
      replyText: 'https://x.id/guarantee.html',
      groundedAmounts: [],
      groundedUrls: [],
      topic: 'blue_fire',
    })
    expect(result.guaranteeViolations).toEqual([])
  })

  it('tetap menandai kalimat jaminan yang sungguhan meski balasan juga memuat URL', () => {
    const result = verifyReply({
      replyText: 'Blue fire is guaranteed every night! Details: https://x.id/guarantee.html',
      groundedAmounts: [],
      groundedUrls: [],
      topic: 'blue_fire',
    })
    expect(result.guaranteeViolations).toContain('guaranteed')
  })

  // Task 22 (Ruling R101): cek jaminan berjalan bila topik UTAMA ATAU salah satu topik
  // TAMBAHAN (classifyAllTopics, multi-topic-classifier.ts) ada di NO_GUARANTEE_TOPICS --
  // bukan hanya topik utama. Pesan yang topik utamanya 'payment' tapi juga menanyakan
  // blue_fire (alsoTopics: ['blue_fire']) tidak boleh lolos tanpa cek jaminan.
  it('cek jaminan berjalan lewat alsoTopics walau topik utama di luar NO_GUARANTEE_TOPICS', () => {
    const result = verifyReply({
      replyText: 'Blue fire is guaranteed in May!',
      groundedAmounts: [],
      groundedUrls: [],
      topic: 'payment',
      alsoTopics: ['blue_fire'],
    })
    expect(result.guaranteeViolations).toContain('guaranteed')
  })

  it('tidak menandai apa pun saat topik utama maupun alsoTopics sama-sama di luar NO_GUARANTEE_TOPICS', () => {
    const result = verifyReply({
      replyText: 'Your booking is guaranteed once the deposit clears.',
      groundedAmounts: [],
      groundedUrls: [],
      topic: 'payment',
      alsoTopics: ['booking', 'cancellation'],
    })
    expect(result.guaranteeViolations).toEqual([])
  })

  it('alsoTopics kosong (default) berperilaku sama seperti sebelum Task 22', () => {
    const result = verifyReply({
      replyText: 'Blue fire is guaranteed in May!',
      groundedAmounts: [],
      groundedUrls: [],
      topic: 'blue_fire',
    })
    expect(result.guaranteeViolations).toContain('guaranteed')
  })

  // URL stripping is scoped to the guarantee scan ONLY -- unknownUrls must still see the full
  // reply, so an unregistered link is still caught.
  it('tidak mengubah pemeriksaan unknownUrls (URL tetap diperiksa penuh)', () => {
    const result = verifyReply({
      replyText: 'Blue fire is guaranteed! See https://javavolcano-touroperator.com/tours/made-up-package',
      groundedAmounts: [],
      groundedUrls: ['https://javavolcano-touroperator.com/tours/ijen-blue-fire-1d'],
      topic: 'blue_fire',
    })
    expect(result.unknownUrls).toEqual(['https://javavolcano-touroperator.com/tours/made-up-package'])
  })
})

describe('buildVerificationRetryInstruction', () => {
  it('names both the fabricated prices and the unknown links, and never the merely-unverified ones', () => {
    const instruction = buildVerificationRetryInstruction({
      fabricatedPrices: [2000000],
      unverifiedPrices: [9999999],
      unknownUrls: ['https://javavolcano-touroperator.com/tours/made-up-package'],
      guaranteeViolations: [],
    })
    expect(instruction).toContain('Rp2.000.000')
    expect(instruction).toContain('https://javavolcano-touroperator.com/tours/made-up-package')
    // An unverified figure is advisory -- it is still sent, so the retry must
    // never tell the model that a legitimate calculation was fabricated.
    expect(instruction).not.toContain('9.999.999')
  })
})

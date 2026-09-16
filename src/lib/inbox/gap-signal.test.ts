import { describe, it, expect } from 'vitest'
import { DEFERRED_KNOWLEDGE_REPLY_REASON, isUnsourcedFaqReply, knowledgeGapForDecision, knowledgeGapsForDecision, knowledgeGapReasonForDecision, UNSOURCED_REPLY_REASON } from './gap-signal'
import type { BotDecision, DecisionKnowledge } from '@/lib/bot/types'
import { attributeReply } from '@/lib/bot/reply-attribution'

function knowledge(overrides: Partial<DecisionKnowledge> = {}): DecisionKnowledge {
  return {
    catalogLines: [],
    managedLines: [{ line: 'ATV 1 jam: IDR 350000', source: 'FAQ Harga ATV (v2)', sourceId: 'ks_1', sourceKey: 'managed/atv', version: 2 }],
    rejected: [],
    gateBypassed: false,
    attributions: [],
    ...overrides,
  }
}

function faq(overrides: Partial<Extract<BotDecision, { mode: 'faq' }>> = {}): BotDecision {
  return { mode: 'faq', draft: 'Halo kak!', sourceTopic: 'price', knowledge: knowledge(), ...overrides }
}

describe('isUnsourcedFaqReply', () => {
  it('menandai balasan FAQ yang punya fakta tetapi tidak satu paragraf pun cocok', () => {
    expect(isUnsourcedFaqReply(faq())).toBe(true)
  })

  it('tidak menandai balasan yang paragrafnya cocok dengan fakta', () => {
    const attributions = [{ paragraph: 0, lines: [{ kind: 'managed' as const, line: 'ATV 1 jam: IDR 350000', sourceId: 'ks_1', title: 'FAQ Harga ATV', version: 2 }] }]
    expect(isUnsourcedFaqReply(faq({ knowledge: knowledge({ attributions }) }))).toBe(false)
  })

  it('tidak menandai giliran tanpa fakta sama sekali -- itu wilayah no_facts_resolved', () => {
    expect(isUnsourcedFaqReply(faq({ knowledge: knowledge({ catalogLines: [], managedLines: [] }) }))).toBe(false)
  })

  it('tidak menandai balasan lama yang pemetaannya tidak pernah dihitung', () => {
    expect(isUnsourcedFaqReply(faq({ knowledge: knowledge({ attributions: undefined }) }))).toBe(false)
  })

  it('tidak menandai keputusan tanpa knowledge sama sekali', () => {
    expect(isUnsourcedFaqReply({ mode: 'faq', draft: 'x', sourceTopic: 'price' })).toBe(false)
  })

  it('tidak pernah menandai clarify, handoff, atau booking_context', () => {
    expect(isUnsourcedFaqReply({ mode: 'clarify', reply: 'Ke mana?', knowledge: knowledge() })).toBe(false)
    expect(isUnsourcedFaqReply({ mode: 'handoff', reason: 'eskalasi', knowledge: knowledge() })).toBe(false)
    expect(isUnsourcedFaqReply({ mode: 'booking_context', reply: 'Berangkat 5 Agustus.', knowledge: knowledge() })).toBe(false)
  })

  it('menandai walau faktanya hanya dari katalog', () => {
    expect(isUnsourcedFaqReply(faq({ knowledge: knowledge({ catalogLines: ['Every package includes private transport.'], managedLines: [] }) }))).toBe(true)
  })

  it('tidak menandai harga atau URL yang sudah lolos verifier walau attribution kosong', () => {
    expect(
      isUnsourcedFaqReply(
        faq({
          draft:
            'Harga paketnya Rp4.550.000 per orang untuk 2 pax, total Rp9.100.000. Detail: https://javavolcano-touroperator.com/tours/ijen-blue-fire-1d',
          verification: {
            status: 'PASSED',
            attempts: 1,
            fabricatedPrices: [],
            unverifiedPrices: [],
            wrongPaxTierPrices: [],
            unknownUrls: [],
            misdirectedUrls: [],
            unsupportedClaims: [],
            guaranteeViolations: [],
          },
          knowledge: knowledge({
            catalogLines: ['Private tour includes transport and guide.'],
            managedLines: [],
            attributions: [],
          }),
        }),
      ),
    ).toBe(false)
  })
})

describe('knowledgeGapReasonForDecision', () => {
  it('menandai balasan FAQ yang menunda sub-pertanyaan karena knowledge belum cukup', () => {
    expect(
      knowledgeGapReasonForDecision(
        faq({
          draft:
            "Harga totalnya Rp9.100.000. Let me check with our team regarding the space for your two large backpacks and get back to you shortly.",
          verification: {
            status: 'PASSED',
            attempts: 1,
            fabricatedPrices: [],
            unverifiedPrices: [],
            wrongPaxTierPrices: [],
            unknownUrls: [],
            misdirectedUrls: [],
            unsupportedClaims: [],
            guaranteeViolations: [],
          },
          knowledge: knowledge({
            catalogLines: ['We use an AC MPV for 1-3 guests.'],
            managedLines: [],
            attributions: [{ paragraph: 0, lines: [{ kind: 'catalog', line: 'We use an AC MPV for 1-3 guests.' }] }],
          }),
        }),
      ),
    ).toBe(DEFERRED_KNOWLEDGE_REPLY_REASON)
  })

  it('tetap memakai reason reply_unsourced untuk balasan FAQ tanpa satu pun attribution', () => {
    expect(knowledgeGapReasonForDecision(faq())).toBe(UNSOURCED_REPLY_REASON)
  })

  it('tidak menandai disclosure availability biasa sebagai deferred knowledge', () => {
    expect(
      knowledgeGapReasonForDecision(
        faq({
          draft:
            'Harga totalnya Rp9.100.000, subject to availability and confirmation. Exact availability for your dates is confirmed automatically at checkout.',
          verification: {
            status: 'PASSED',
            attempts: 1,
            fabricatedPrices: [],
            unverifiedPrices: [],
            wrongPaxTierPrices: [],
            unknownUrls: [],
            misdirectedUrls: [],
            unsupportedClaims: [],
            guaranteeViolations: [],
          },
          knowledge: knowledge({
            catalogLines: ['2 pax price: IDR 4550000 per person.'],
            managedLines: [],
            attributions: [{ paragraph: 0, lines: [{ kind: 'catalog', line: '2 pax price: IDR 4550000 per person.' }] }],
          }),
        }),
      ),
    ).toBeNull()
  })
})

describe('knowledgeGapForDecision', () => {
  it('memilih sub-pertanyaan paling dekat untuk paragraf deferred knowledge', () => {
    expect(
      knowledgeGapForDecision(
        faq({
          draft:
            'Hi! Let me check with our team about Ijen safety and get back to you shortly.\n\nFor cancellation, day-1 cancellation is not refundable.',
          sourceTopic: 'cancellation',
          topic: 'cancellation',
          knowledge: knowledge({
            catalogLines: ['Day-1 cancellation is not refundable.'],
            managedLines: [],
            attributions: [{ paragraph: 1, lines: [{ kind: 'catalog', line: 'Day-1 cancellation is not refundable.' }] }],
          }),
        }),
        'Is Ijen safe? Can I cancel tour at the day 1 trip?',
      ),
    ).toEqual({
      reason: DEFERRED_KNOWLEDGE_REPLY_REASON,
      missingQuestion: 'Is Ijen safe?',
      answerSnippet: 'Hi! Let me check with our team about Ijen safety and get back to you shortly.',
      answerParagraph: 0,
    })
  })

  it('menandai paragraf tanpa attribution walau paragraf lain bersumber', () => {
    expect(
      knowledgeGapForDecision(
        faq({
          draft:
            'Hi! Ijen is safe for travelers with normal fitness.\n\nFor cancellation, day-1 cancellation is not refundable.',
          sourceTopic: 'cancellation',
          topic: 'cancellation',
          knowledge: knowledge({
            catalogLines: ['Day-1 cancellation is not refundable.'],
            managedLines: [],
            attributions: [{ paragraph: 1, lines: [{ kind: 'catalog', line: 'Day-1 cancellation is not refundable.' }] }],
          }),
        }),
        'Is Ijen safe? Can I cancel tour at the day 1 trip?',
      ),
    ).toEqual({
      reason: UNSOURCED_REPLY_REASON,
      missingQuestion: 'Is Ijen safe?',
      answerSnippet: 'Hi! Ijen is safe for travelers with normal fitness.',
      answerParagraph: 0,
    })
  })
})


// Dilaporkan 14 September 2026 dari balasan produksi: satu balasan menunda DUA pertanyaan
// pelanggan (waktu jemput, dan berangkat sore) dengan dua kalimat "Let me check with our team"
// terpisah, tetapi hanya satu yang muncul di daftar perbaikan -- `deferredParagraph` berhenti
// di paragraf pertama yang cocok, jadi pertanyaan kedua tidak pernah tercatat dan tidak pernah
// bisa diperbaiki.
describe('knowledgeGapsForDecision', () => {
  const draftDuaTunda = [
    'Hi!',
    '* Yes, the tour is available; the price for 4 people is Rp3.050.000 per person.',
    '* Let me check with our team regarding the flexibility of the pickup time and I will get back to you shortly!',
    '* Let me check with our team if leaving at 16:00-17:00 is possible without affecting the itinerary and I will follow up shortly!',
  ].join('\n\n')

  const inbound = [
    'We also noticed that the standard itinerary starts from Surabaya around 12:00. Could you please tell us how flexible the pickup time is on the first day?',
    'Since Bromo is visited the following morning, would it also be possible to leave Surabaya later in the afternoon, for example around 16:00-17:00, without affecting the main itinerary?',
  ].join(' ')

  it('mencatat SETIAP paragraf yang ditunda, bukan hanya yang pertama', () => {
    const gaps = knowledgeGapsForDecision(faq({ draft: draftDuaTunda }), inbound)

    expect(gaps).toHaveLength(2)
    expect(gaps.map((g) => g.reason)).toEqual([DEFERRED_KNOWLEDGE_REPLY_REASON, DEFERRED_KNOWLEDGE_REPLY_REASON])
    expect(gaps[0].answerSnippet).toContain('flexibility of the pickup time')
    expect(gaps[1].answerSnippet).toContain('16:00-17:00')
  })

  it('memasangkan tiap paragraf tunda dengan pertanyaan pelanggan yang paling dekat', () => {
    const gaps = knowledgeGapsForDecision(faq({ draft: draftDuaTunda }), inbound)

    expect(gaps[0].missingQuestion).toContain('pickup time')
    expect(gaps[1].missingQuestion).toContain('16:00-17:00')
  })

  it('menomori paragrafnya sesuai posisi aslinya di balasan', () => {
    const gaps = knowledgeGapsForDecision(faq({ draft: draftDuaTunda }), inbound)

    expect(gaps.map((g) => g.answerParagraph)).toEqual([2, 3])
  })

  it('tetap satu baris untuk balasan yang hanya menunda satu pertanyaan', () => {
    const draft = 'Hi!\n\n* Let me check with our team regarding the pickup time and I will get back to you shortly!'
    expect(knowledgeGapsForDecision(faq({ draft }), 'How flexible is the pickup time?')).toHaveLength(1)
  })

  it('tidak menandai gap untuk paragraf pickup sore yang sudah memuat rekomendasi Bromo-first berbasis durasi rute', () => {
    const sourceLine =
      'With pickup after 12:00, we recommend visiting Bromo first: Surabaya to the Bromo area takes about 3.5–4.5 hours, while Surabaya to Bondowoso (the base for Ijen) takes about 6-8 hours, so starting with Bromo leaves more time to rest before the midnight departure to Ijen.'
    const draft =
      'Hi! Let me check that 5 PM pickup timing with our team and get back to you shortly! Since you arrive late, we recommend visiting Bromo first because the drive is shorter (3.5–4.5 hours) than to Ijen (6–8 hours), allowing you more rest before the midnight Ijen hike.'
    const decision = faq({
      draft,
      sourceTopic: 'route_endpoint',
      knowledge: knowledge({
        catalogLines: [sourceLine],
        managedLines: [],
        attributions: [{ paragraph: 0, lines: [{ kind: 'catalog', line: sourceLine }] }],
      }),
    })

    expect(knowledgeGapsForDecision(decision, 'Can we join after we arrive around 5 PM instead of starting at noon?')).toEqual([])
  })

  it('mengembalikan daftar kosong saat tidak ada gap sama sekali', () => {
    const attributions = [{ paragraph: 0, lines: [{ kind: 'managed' as const, line: 'ATV 1 jam: IDR 350000', sourceId: 'ks_1', title: 'FAQ Harga ATV', version: 2 }] }]
    expect(knowledgeGapsForDecision(faq({ knowledge: knowledge({ attributions }) }), 'berapa harga atv?')).toEqual([])
  })

  // Pemanggil lama (lonceng, ikon gelembung) tetap memakai bentuk tunggal, dan ia harus
  // menjawab persis sama seperti sebelumnya: gap pertama.
  it('bentuk tunggalnya tetap mengembalikan gap pertama', () => {
    const first = knowledgeGapForDecision(faq({ draft: draftDuaTunda }), inbound)
    expect(first).toEqual(knowledgeGapsForDecision(faq({ draft: draftDuaTunda }), inbound)[0])
  })
})


// Dilaporkan 14 September 2026 (balasan Amine): paragraf kebijakan ketersediaan ditandai
// "tidak punya knowledge", dan panel meminta operator menambah knowledge untuk pertanyaan yang
// sudah dijawab benar. Pemetaannya dihitung oleh attributeReply sungguhan -- persis seperti titik
// tempel orchestrator -- supaya test ini membuktikan jalur utuhnya, bukan pemetaan tulisan tangan.
describe('knowledgeGapsForDecision -- kalimat kebijakan bukan gap', () => {
  const catalogLines = [
    'This is a private tour with your own dedicated driver and guide(s); you are never combined with another group.',
    'Every package includes private transport, a dedicated driver and guide(s), all entrance fees and permits, drinking water, meals as stated, and full pick-up to drop-off assistance.',
  ]

  // `verification` disalin dari keputusan produksi Amine (PASSED, semua daftar kosong). Tanpanya
  // paragraf yang hanya berisi link terverifikasi ikut tertandai -- sesuatu yang di produksi tidak
  // terjadi, jadi fixture tanpa verification menguji keputusan yang tidak pernah ada.
  function decisionFor(draft: string): BotDecision {
    const k = knowledge({ catalogLines, managedLines: [], attributions: [] })
    return faq({
      draft,
      sourceTopic: 'private_tour',
      verification: {
        status: 'PASSED',
        attempts: 1,
        fabricatedPrices: [],
        unverifiedPrices: [],
        wrongPaxTierPrices: [],
        unknownUrls: [],
        misdirectedUrls: [],
        unsupportedClaims: [],
        guaranteeViolations: [],
      },
      knowledge: { ...k, attributions: attributeReply(draft, k) },
    })
  }

  it('tidak menandai balasan Amine, yang paragraf lainnya sudah bersumber', () => {
    const draft = [
      'Hi! Our tours are 100% private, meaning you will have your own dedicated driver and guide without any strangers.',
      'Our tours are nearly always available, and your exact dates will be confirmed automatically at checkout when you book through our website.',
      'https://javavolcano-touroperator.com/tours/from-surabaya/bromo-madakaripura-ijen-3d2n',
    ].join('\n\n')

    expect(knowledgeGapsForDecision(decisionFor(draft), 'Do you have availability for 13-15 September?')).toEqual([])
  })

  it('tetap menandai paragraf yang benar-benar tidak bersumber, walau paragraf lain cocok dengan kebijakan', () => {
    const draft = [
      'Our tours are nearly always available, and your exact dates will be confirmed automatically at checkout when you book through our website.',
      'You can also bring your pet dragon on the Ijen hike at no extra charge.',
    ].join('\n\n')

    const gaps = knowledgeGapsForDecision(decisionFor(draft), 'Can I bring my pet dragon?')
    expect(gaps).toHaveLength(1)
    expect(gaps[0].answerSnippet).toContain('pet dragon')
  })
})

describe('knowledgeGapsForDecision -- kalimat paket tidak standar bukan gap', () => {
  it('tidak menandai paragraf pembuka alternatif terdekat pada balasan Arpan', () => {
    // Paragraf inklusi yang BERSUMBER wajib ada: tanpa satu pun paragraf yang cocok, gap-signal
    // memakai pengecualian lain (harga/URL terverifikasi di seluruh draft) dan test ini lulus tanpa
    // menguji apa pun -- itu yang terjadi pada versi pertamanya. Di produksi paragraf inklusi Arpan
    // memang bersumber, jadi hanya paragraf pembukanya yang tertandai.
    const draft = [
      "Hi! We don't have a standard package that starts and ends in Bali for those dates, but our team can adjust the specifics for you after booking. Here are the closest options:",
      '- 3 Day Bromo & Ijen Volcano Discovery from Bali: Rp3.800.000/person (for 3 pax) - https://javavolcano-touroperator.com/tours/from-bali/bromo-ijen-3d2n',
      'Prices are subject to availability and confirmation. Inclusions are private transport, dedicated driver/guide, all entrance fees, 4WD Jeep for Bromo, gas masks, and medical screenings for Ijen.',
    ].join('\n\n')
    const k = knowledge({
      catalogLines: [
        'Every package includes private transport, a dedicated driver and guide(s), all entrance fees and permits, drinking water, meals as stated, and full pick-up to drop-off assistance.',
      ],
      managedLines: [],
      attributions: [],
    })
    const decision = faq({
      draft,
      sourceTopic: 'inclusions',
      verification: {
        status: 'PASSED', attempts: 1, fabricatedPrices: [], unverifiedPrices: [], wrongPaxTierPrices: [],
        unknownUrls: [], misdirectedUrls: [], unsupportedClaims: [], guaranteeViolations: [],
      },
      knowledge: { ...k, attributions: attributeReply(draft, k) },
    })

    expect(knowledgeGapsForDecision(decision, 'Please share your best all-inclusive price.')).toEqual([])
  })
})

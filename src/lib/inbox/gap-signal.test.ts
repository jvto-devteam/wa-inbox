import { describe, it, expect } from 'vitest'
import { DEFERRED_KNOWLEDGE_REPLY_REASON, isUnsourcedFaqReply, knowledgeGapReasonForDecision, UNSOURCED_REPLY_REASON } from './gap-signal'
import type { BotDecision, DecisionKnowledge } from '@/lib/bot/types'

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
            unknownUrls: [],
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
            unknownUrls: [],
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
            unknownUrls: [],
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

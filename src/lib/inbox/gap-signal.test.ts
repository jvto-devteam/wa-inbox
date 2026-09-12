import { describe, it, expect } from 'vitest'
import { isUnsourcedFaqReply } from './gap-signal'
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
})

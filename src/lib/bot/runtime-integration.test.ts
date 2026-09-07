/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { isRuleEnabled } from '@/lib/bot-control/runtime-rules'
import { getFlowText } from '@/lib/bot-control/runtime-flows'
import { loadPublishedManagedKnowledge } from '@/lib/bot/managed-knowledge'
import { shouldRunEscalationClassifier, fallbackReplyText, managedFactsFor } from './runtime-integration'

vi.mock('@/lib/bot-control/runtime-rules', () => ({ isRuleEnabled: vi.fn() }))
vi.mock('@/lib/bot-control/runtime-flows', () => ({ getFlowText: vi.fn() }))
vi.mock('@/lib/bot/managed-knowledge', () => ({ loadPublishedManagedKnowledge: vi.fn() }))

function entry(overrides: Record<string, unknown> = {}) {
  return {
    sourceId: 'ks_1',
    sourceKey: 'managed/atv',
    sourceTitle: 'FAQ Harga ATV',
    revisionId: 'krev_1',
    version: 2,
    items: [{ question: 'Berapa harga paket ATV?', answer: 'Mulai Rp350.000 per orang.' }],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(isRuleEnabled).mockResolvedValue(true)
  vi.mocked(getFlowText).mockImplementation(async (_key, _field, fallback) => fallback)
  vi.mocked(loadPublishedManagedKnowledge).mockResolvedValue({ entries: [], available: true, loadedAt: 0 })
})

describe('shouldRunEscalationClassifier', () => {
  it('asks the rule that governs the LLM escalation layer', async () => {
    await shouldRunEscalationClassifier()
    expect(isRuleEnabled).toHaveBeenCalledWith('bot.handoff_on_human_request')
  })

  it('is false once the rule is published disabled', async () => {
    vi.mocked(isRuleEnabled).mockResolvedValue(false)
    expect(await shouldRunEscalationClassifier()).toBe(false)
  })
})

describe('fallbackReplyText', () => {
  it('returns the code default when nothing is published', async () => {
    expect(await fallbackReplyText('kalimat bawaan')).toBe('kalimat bawaan')
  })

  it('returns the published wording when there is one', async () => {
    vi.mocked(getFlowText).mockResolvedValue('Saya cek dulu ya.')
    expect(await fallbackReplyText('kalimat bawaan')).toBe('Saya cek dulu ya.')
  })
})

describe('managedFactsFor', () => {
  it('returns nothing when no managed knowledge is published', async () => {
    expect(await managedFactsFor('Berapa harga ATV?')).toEqual({ lines: [], refs: [] })
  })

  it('folds in an entry whose question shares a word with the message', async () => {
    vi.mocked(loadPublishedManagedKnowledge).mockResolvedValue({ entries: [entry()], available: true, loadedAt: 0 })

    const facts = await managedFactsFor('berapa harga paket ATV untuk 4 orang?')
    expect(facts.lines[0]).toContain('Mulai Rp350.000')
    expect(facts.refs).toEqual([
      { sourceType: 'MANAGED', sourceKey: 'managed/atv', title: 'FAQ Harga ATV', version: 2 },
    ])
  })

  it('leaves out an entry with nothing to do with the message', async () => {
    // Folding EVERY published entry into every prompt would bury the catalog facts the answer
    // actually needs, and hand the verifier prices the question never asked about.
    vi.mocked(loadPublishedManagedKnowledge).mockResolvedValue({ entries: [entry()], available: true, loadedAt: 0 })
    expect((await managedFactsFor('jam berapa pickup dari bandara?')).lines).toEqual([])
  })

  it('matches on tags as well as the question', async () => {
    vi.mocked(loadPublishedManagedKnowledge).mockResolvedValue({
      entries: [entry({ items: [{ question: 'Q', answer: 'A', tags: ['snorkeling'] }] })],
      available: true,
      loadedAt: 0,
    })
    expect((await managedFactsFor('ada paket snorkeling?')).lines).toHaveLength(1)
  })

  it('ignores short and common words, so everything does not match everything', async () => {
    vi.mocked(loadPublishedManagedKnowledge).mockResolvedValue({
      entries: [entry({ items: [{ question: 'apa yang bisa saya bawa?', answer: 'A' }] })],
      available: true,
      loadedAt: 0,
    })
    expect((await managedFactsFor('apa yang bisa saya lakukan di ijen?')).lines).toEqual([])
  })

  it('emits prices and links as their own lines, so the verifier can source them', async () => {
    // A figure buried in prose is indistinguishable, to the reply verifier, from one the model
    // invented — which is exactly what bot.no_invented_price protects against.
    vi.mocked(loadPublishedManagedKnowledge).mockResolvedValue({
      entries: [
        entry({
          items: [
            {
              question: 'Berapa harga ATV?',
              answer: 'Tergantung paket.',
              prices: [{ label: 'ATV 1 jam', amount: 350000, currency: 'IDR' }],
              links: [{ label: 'Detail', url: 'https://example.com/atv' }],
            },
          ],
        }),
      ],
      available: true,
      loadedAt: 0,
    })

    const facts = await managedFactsFor('berapa harga ATV?')
    expect(facts.lines.some((line) => line.includes('IDR 350000'))).toBe(true)
    expect(facts.lines.some((line) => line.includes('https://example.com/atv'))).toBe(true)
  })

  it('returns nothing rather than throwing when the loader fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(loadPublishedManagedKnowledge).mockRejectedValue(new Error('db down'))
    expect(await managedFactsFor('berapa harga ATV?')).toEqual({ lines: [], refs: [] })
  })

  it('returns nothing for a message with no usable words', async () => {
    vi.mocked(loadPublishedManagedKnowledge).mockResolvedValue({ entries: [entry()], available: true, loadedAt: 0 })
    expect((await managedFactsFor('ok!')).lines).toEqual([])
  })
})

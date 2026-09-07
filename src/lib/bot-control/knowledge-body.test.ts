/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest'
import { validateKnowledgeBody, readKnowledgeBody } from './knowledge-body'

const valid = { items: [{ question: 'Berapa harga ATV?', answer: 'Mengikuti paket di katalog aktif.' }] }

describe('validateKnowledgeBody', () => {
  it('accepts a minimal question and answer', () => {
    expect(validateKnowledgeBody(valid)).toEqual({ ok: true, body: valid })
  })

  it('rejects an empty knowledge source', () => {
    // Publishing one would put a row in the explorer claiming the bot knows something, backed
    // by nothing.
    expect(validateKnowledgeBody({ items: [] }).ok).toBe(false)
  })

  it('rejects an item with no answer, naming the field', () => {
    // This is not a layout bug: the bot reads this, and a missing answer is a customer being
    // told `undefined`.
    const result = validateKnowledgeBody({ items: [{ question: 'Halo?' }] })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('answer')
  })

  it('rejects an unknown key rather than silently dropping it', () => {
    const result = validateKnowledgeBody({ items: [{ ...valid.items[0], catatan: 'x' }] })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('catatan')
  })

  it('accepts structured prices and links', () => {
    // `bot.no_invented_price` and `bot.no_invented_url` are CRITICAL: the bot may only state a
    // price or URL it can source, so a new source has to make them machine-readable.
    const result = validateKnowledgeBody({
      items: [
        {
          ...valid.items[0],
          prices: [{ label: 'ATV 1 jam', amount: 350000, currency: 'IDR' }],
          links: [{ label: 'Detail paket', url: 'https://javavolcano-touroperator.com/atv' }],
          tags: ['atv', 'harga'],
        },
      ],
    })
    expect(result.ok).toBe(true)
  })

  it('rejects a negative price', () => {
    const result = validateKnowledgeBody({
      items: [{ ...valid.items[0], prices: [{ label: 'x', amount: -1, currency: 'IDR' }] }],
    })
    expect(result.ok).toBe(false)
  })

  it('rejects a price with no currency, which the bot would have to guess', () => {
    const result = validateKnowledgeBody({
      items: [{ ...valid.items[0], prices: [{ label: 'x', amount: 100 }] }],
    })
    expect(result.ok).toBe(false)
  })

  it.each([
    ['javascript:', 'javascript:alert(1)'],
    ['data:', 'data:text/html,<script>alert(1)</script>'],
    ['ftp:', 'ftp://example.com/file'],
  ])('rejects a %s URL, which would reach a customer as a WhatsApp link', (_label, url) => {
    const result = validateKnowledgeBody({ items: [{ ...valid.items[0], links: [{ label: 'x', url }] }] })
    expect(result.ok).toBe(false)
  })

  it('rejects a body that is not an object at all', () => {
    expect(validateKnowledgeBody(null).ok).toBe(false)
    expect(validateKnowledgeBody('teks biasa').ok).toBe(false)
    expect(validateKnowledgeBody([valid.items[0]]).ok).toBe(false)
  })
})

describe('readKnowledgeBody', () => {
  it('returns null for a shape this build cannot read', () => {
    // The caller skips it rather than handing the bot something it will dereference blindly
    // mid-conversation.
    expect(readKnowledgeBody({ bentuk: 'lama' })).toBeNull()
    expect(readKnowledgeBody(null)).toBeNull()
  })

  it('returns the parsed body for a valid one', () => {
    expect(readKnowledgeBody(valid)).toEqual(valid)
  })
})

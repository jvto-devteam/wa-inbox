import { describe, it, expect } from 'vitest'
import { autoDraftTarget, isDraftableText } from './draft-target'

const inText = (id: string, content = 'teks') => ({ id, direction: 'INBOUND', type: 'text', content })
const inImage = (id: string) => ({ id, direction: 'INBOUND', type: 'image', content: 'caption' })
const out = (id: string) => ({ id, direction: 'OUTBOUND', type: 'text', content: 'balasan' })

describe('isDraftableText', () => {
  it('teks berisi (atau type hilang) bisa; media berkaption dan teks kosong tidak', () => {
    expect(isDraftableText({ type: 'text', content: 'halo' })).toBe(true)
    expect(isDraftableText({ content: 'halo' })).toBe(true)
    expect(isDraftableText({ type: 'image', content: 'caption' })).toBe(false)
    expect(isDraftableText({ type: 'text', content: '  ' })).toBe(false)
  })
})

describe('autoDraftTarget', () => {
  it('memilih pesan teks masuk TERAKHIR dalam run, berhenti di OUTBOUND berikutnya', () => {
    const messages = [out('o0'), inText('a', 'Halo'), inText('b', 'Berapa harganya?'), out('o1'), inText('c')]
    expect(autoDraftTarget(messages, 'a')).toEqual({ kind: 'target', messageId: 'b' })
  })

  it('pesan pertama non-teks: target pesan teks sesudahnya', () => {
    expect(autoDraftTarget([inImage('a'), inText('b')], 'a')).toEqual({ kind: 'target', messageId: 'b' })
  })

  it('teks terakhir di run dipakai walau sesudahnya ada media', () => {
    expect(autoDraftTarget([inText('a'), inText('b'), inImage('c')], 'a')).toEqual({ kind: 'target', messageId: 'b' })
  })

  it('run tanpa satu pun pesan teks: no-text', () => {
    expect(autoDraftTarget([inImage('a'), inImage('b'), out('o'), inText('c')], 'a')).toEqual({ kind: 'no-text' })
  })

  it('pesan fokus tidak ada atau bukan pesan masuk: none', () => {
    expect(autoDraftTarget([inText('a')], 'x')).toEqual({ kind: 'none' })
    expect(autoDraftTarget([out('o'), inText('a')], 'o')).toEqual({ kind: 'none' })
  })
})

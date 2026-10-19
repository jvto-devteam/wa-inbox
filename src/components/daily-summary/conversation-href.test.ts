import { describe, it, expect } from 'vitest'
import { conversationHref } from './conversation-href'

describe('conversationHref', () => {
  it('tanpa pesan hanya membawa percakapan', () => {
    expect(conversationHref('c 1')).toBe('/inbox?conversation=c%201')
  })

  it('lihat dan draft hanya ditulis bersama pesan sorot', () => {
    expect(conversationHref('c1', 'm1', { lihat: true })).toBe('/inbox?conversation=c1&message=m1&lihat=1')
    expect(conversationHref('c1', 'm1', { draft: true })).toBe('/inbox?conversation=c1&message=m1&draft=1')
    expect(conversationHref('c1', null, { draft: true, lihat: true })).toBe('/inbox?conversation=c1')
  })

  it('followup tidak butuh pesan sorot', () => {
    expect(conversationHref('c1', null, { followup: true })).toBe('/inbox?conversation=c1&followup=1')
  })
})

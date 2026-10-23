import { describe, expect, it } from 'vitest'
import { loginPathFor, safeNextPath } from './next-path'

describe('safeNextPath', () => {
  it('jalur internal diterima apa adanya, termasuk query', () => {
    expect(safeNextPath('/ai-office')).toBe('/ai-office')
    expect(safeNextPath('/inbox?conversation=c1&message=m2')).toBe('/inbox?conversation=c1&message=m2')
  })

  it('alamat luar, putaran ke /login, dan /api ditolak ke dasbor', () => {
    for (const bad of [null, '', 'https://evil.com', '//evil.com', '/\\evil.com', 'javascript:alert(1)', '/login', '/login?next=/x', '/api/send', '/a\nb']) {
      expect(safeNextPath(bad)).toBe('/dashboard')
    }
    expect(safeNextPath(`/${'a'.repeat(600)}`)).toBe('/dashboard')
  })
})

describe('loginPathFor', () => {
  it('menitipkan jalur asal; dasbor/beranda tanpa next', () => {
    expect(loginPathFor('/ai-office')).toBe('/login?next=%2Fai-office')
    expect(loginPathFor('/inbox', '?conversation=c1')).toBe('/login?next=%2Finbox%3Fconversation%3Dc1')
    expect(loginPathFor('/dashboard')).toBe('/login')
    expect(loginPathFor('/')).toBe('/login')
  })
})

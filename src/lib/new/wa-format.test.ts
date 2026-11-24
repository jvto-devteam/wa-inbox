import { describe, expect, it } from 'vitest'
import { waLines, waTokens } from './wa-format'

describe('format WhatsApp', () => {
  it('tebal, miring, coret, mono', () => {
    expect(waTokens('*Booking Details*')).toEqual([{ t: 'b', v: 'Booking Details' }])
    expect(waTokens('Hi _John_, ~old~ price')).toEqual([
      { t: 'text', v: 'Hi ' }, { t: 'i', v: 'John' }, { t: 'text', v: ', ' }, { t: 's', v: 'old' }, { t: 'text', v: ' price' },
    ])
    expect(waTokens('kode ```JV-1```')).toEqual([{ t: 'text', v: 'kode ' }, { t: 'm', v: 'JV-1' }])
  })

  it('penanda yang tidak menempel kata atau di tengah kata tetap teks biasa', () => {
    expect(waTokens('2 * 3 * 4')).toEqual([{ t: 'text', v: '2 * 3 * 4' }])
    expect(waTokens('customer_name_x')).toEqual([{ t: 'text', v: 'customer_name_x' }])
  })

  it('tautan dikenali, termasuk jvto.me tanpa skema', () => {
    expect(waTokens('Portal: jvto.me/b/Ab3dE5fG7h')).toEqual([{ t: 'text', v: 'Portal: ' }, { t: 'link', v: 'jvto.me/b/Ab3dE5fG7h' }])
    expect(waTokens('lihat https://javavolcano-touroperator.com/x')).toEqual([{ t: 'text', v: 'lihat ' }, { t: 'link', v: 'https://javavolcano-touroperator.com/x' }])
  })

  it('dibagi per baris; baris kosong tetap ada', () => {
    expect(waLines('a\n\n*b*').map((l) => l.length)).toEqual([1, 0, 1])
  })
})

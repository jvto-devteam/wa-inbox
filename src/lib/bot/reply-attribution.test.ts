import { describe, it, expect } from 'vitest'
import { attributeReply, splitParagraphs, MIN_SHARED_CONTENT_WORDS, MIN_SHARED_RATIO } from './reply-attribution'
import type { DecisionKnowledge } from './types'

function knowledge(overrides: Partial<DecisionKnowledge> = {}): DecisionKnowledge {
  return { catalogLines: [], managedLines: [], rejected: [], gateBypassed: false, ...overrides }
}

const managedPrice = { line: 'ATV 1 jam: IDR 350000', source: 'FAQ Harga ATV (v2)', sourceId: 'ks_1', sourceKey: 'managed/atv', version: 2 }
const managedLink = { line: 'Detail: https://example.com/atv', source: 'FAQ Harga ATV (v2)', sourceId: 'ks_1', sourceKey: 'managed/atv', version: 2 }

describe('splitParagraphs', () => {
  it('memecah per baris kosong', () => {
    expect(splitParagraphs('Satu.\n\nDua.\n\n\nTiga.')).toEqual(['Satu.', 'Dua.', 'Tiga.'])
  })

  it('setiap butir jadi paragraf sendiri, baris lanjutan ikut butirnya', () => {
    expect(splitParagraphs('Pilihan:\n- Paket A\n  termasuk hotel\n- Paket B\n1. Satu\n2) Dua')).toEqual([
      'Pilihan:',
      '- Paket A\ntermasuk hotel',
      '- Paket B',
      '1. Satu',
      '2) Dua',
    ])
  })

  it('teks kosong tidak menghasilkan paragraf', () => {
    expect(splitParagraphs('  \n\n ')).toEqual([])
  })
})

describe('attributeReply', () => {
  it('mencocokkan lewat nominal Rupiah walau formatnya berbeda', () => {
    expect(attributeReply('Halo kak!\n\nHarga ATV Rp350.000 per jam.', knowledge({ managedLines: [managedPrice] }))).toEqual([
      { paragraph: 1, lines: [{ kind: 'managed', line: 'ATV 1 jam: IDR 350000', sourceId: 'ks_1', title: 'FAQ Harga ATV', version: 2 }] },
    ])
  })

  it('mencocokkan lewat URL yang sama', () => {
    expect(attributeReply('Info lengkap: https://example.com/atv.', knowledge({ managedLines: [managedLink] }))).toEqual([
      { paragraph: 0, lines: [{ kind: 'managed', line: managedLink.line, sourceId: 'ks_1', title: 'FAQ Harga ATV', version: 2 }] },
    ])
  })

  it('mencocokkan lewat kata isi di atas ambang, termasuk baris katalog', () => {
    const catalogLine = 'Every package includes private transport and a driver/guide.'
    expect(
      attributeReply('All our packages include private transport with your own driver and guide.', knowledge({ catalogLines: [catalogLine] }))
    ).toEqual([{ paragraph: 0, lines: [{ kind: 'catalog', line: catalogLine }] }])
  })

  it(`ambang kata isi: minimal ${MIN_SHARED_CONTENT_WORDS} kata DAN ${MIN_SHARED_RATIO} dari kata isi baris`, () => {
    const ten = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet'
    // 3 dari 10 kata = 0.3 -> cocok (batas inklusif).
    expect(attributeReply('alpha bravo charlie', knowledge({ catalogLines: [ten] }))).toEqual([
      { paragraph: 0, lines: [{ kind: 'catalog', line: ten }] },
    ])
    // 2 kata -> di bawah jumlah minimum.
    expect(attributeReply('alpha bravo', knowledge({ catalogLines: [ten] }))).toEqual([])
    // 3 dari 11 kata = 0.27 -> di bawah rasio minimum.
    expect(attributeReply('alpha bravo charlie', knowledge({ catalogLines: [`${ten} kilo`] }))).toEqual([])
  })

  it('tidak mencocokkan baris yang hanya berbagi sedikit kata, dan tidak menganggap persen sebagai Rupiah', () => {
    const line = 'Berapa deposit? — 20% dari total, dibayar di Surabaya.'
    expect(
      attributeReply(
        'Deposit bisa ditransfer kapan saja, 20% saja.',
        knowledge({ managedLines: [{ line, source: 'Kebijakan Pembayaran (v3)', sourceId: 'ks_2', sourceKey: 'managed/pay', version: 3 }] })
      )
    ).toEqual([])
  })

  it('satu paragraf bisa cocok dengan beberapa baris: katalog dulu, lalu managed, urut aslinya', () => {
    const unrelated = 'Semua paket termasuk transport privat.'
    expect(
      attributeReply('Harga ATV Rp350.000, detail di https://example.com/atv', knowledge({ catalogLines: [unrelated], managedLines: [managedPrice, managedLink] }))
    ).toEqual([
      {
        paragraph: 0,
        lines: [
          { kind: 'managed', line: managedPrice.line, sourceId: 'ks_1', title: 'FAQ Harga ATV', version: 2 },
          { kind: 'managed', line: managedLink.line, sourceId: 'ks_1', title: 'FAQ Harga ATV', version: 2 },
        ],
      },
    ])
  })

  it('baris lama tanpa sourceId/version tetap tercatat, judulnya source apa adanya', () => {
    expect(
      attributeReply('Harga ATV Rp350.000.', knowledge({ managedLines: [{ line: 'ATV 1 jam: IDR 350000', source: 'FAQ Harga ATV (v2)' }] }))
    ).toEqual([{ paragraph: 0, lines: [{ kind: 'managed', line: 'ATV 1 jam: IDR 350000', title: 'FAQ Harga ATV (v2)' }] }])
  })
})

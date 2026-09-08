/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest'
import type { TripBrief } from '@/lib/bot/types'
import {
  FUNNEL_STAGES,
  FUNNEL_STAGE_LABELS,
  funnelStageIndex,
  resolveFunnelStage,
  type FunnelStage,
} from './funnel'

const stage = (tripBrief: unknown, handedOff?: boolean): FunnelStage =>
  resolveFunnelStage({ tripBrief, handedOff })

describe('daftar tahap funnel', () => {
  it('berurutan sesuai kesepakatan pemilik', () => {
    expect(FUNNEL_STAGES.map((entry) => entry.id)).toEqual([
      'MASUK',
      'TANYA',
      'ADA_TUJUAN',
      'ADA_ROMBONGAN',
      'ADA_TANGGAL',
      'DITERUSKAN',
    ])
  })

  it('punya label bahasa Indonesia untuk setiap tahap', () => {
    for (const entry of FUNNEL_STAGES) {
      expect(FUNNEL_STAGE_LABELS[entry.id]).toBe(entry.label)
      expect(entry.label.trim().length, entry.id).toBeGreaterThan(0)
      expect(entry.description.trim().length, entry.id).toBeGreaterThan(0)
    }
  })

  it('funnelStageIndex mengembalikan posisi urut', () => {
    expect(funnelStageIndex('MASUK')).toBe(0)
    expect(funnelStageIndex('ADA_TANGGAL')).toBe(4)
    expect(funnelStageIndex('DITERUSKAN')).toBe(FUNNEL_STAGES.length - 1)
  })
})

describe('resolveFunnelStage — tiap tahap', () => {
  it('MASUK untuk brief kosong', () => {
    expect(stage({})).toBe('MASUK')
  })

  it('MASUK saat hanya berisi kunci asing yang tidak dikenal', () => {
    expect(stage({ fooBar: 'apa saja', legacyField: 42 })).toBe('MASUK')
  })

  it('TANYA saat percakapan sudah berjalan tapi tujuan belum diketahui', () => {
    expect(stage({ lastTopic: 'price' } satisfies TripBrief)).toBe('TANYA')
    expect(stage({ askedTripPreferences: true } satisfies TripBrief)).toBe('TANYA')
    expect(stage({ origin: 'Surabaya', dayCount: 3 } satisfies TripBrief)).toBe('TANYA')
    expect(stage({ requestedTokens: ['bromo'] } satisfies TripBrief)).toBe('TANYA')
    expect(stage({ pax: 4 } satisfies TripBrief)).toBe('TANYA')
    expect(stage({ dateRange: '12-15 Sep' } satisfies TripBrief)).toBe('TANYA')
  })

  it('ADA_TUJUAN saat destination terisi', () => {
    expect(stage({ destination: 'bromo' } satisfies TripBrief)).toBe('ADA_TUJUAN')
  })

  it('ADA_ROMBONGAN saat destination + pax terisi', () => {
    expect(stage({ destination: 'bromo', pax: 4 } satisfies TripBrief)).toBe('ADA_ROMBONGAN')
  })

  it('ADA_TANGGAL saat destination + pax + dateRange lengkap', () => {
    expect(
      stage({ destination: 'bromo', pax: 4, dateRange: '12-15 Sep 2026' } satisfies TripBrief)
    ).toBe('ADA_TANGGAL')
  })

  it('DITERUSKAN menang atas tahap kelengkapan apa pun', () => {
    expect(stage({}, true)).toBe('DITERUSKAN')
    expect(stage({ destination: 'ijen' } satisfies TripBrief, true)).toBe('DITERUSKAN')
    expect(
      stage({ destination: 'ijen', pax: 2, dateRange: '1 Okt' } satisfies TripBrief, true)
    ).toBe('DITERUSKAN')
  })

  it('DITERUSKAN menang bahkan atas brief yang rusak', () => {
    expect(stage(null, true)).toBe('DITERUSKAN')
    expect(stage('bukan objek', true)).toBe('DITERUSKAN')
    expect(stage([1, 2, 3], true)).toBe('DITERUSKAN')
  })

  it('handedOff false/undefined tidak mengubah apa pun', () => {
    expect(stage({ destination: 'bromo' } satisfies TripBrief, false)).toBe('ADA_TUJUAN')
    expect(stage({ destination: 'bromo' } satisfies TripBrief, undefined)).toBe('ADA_TUJUAN')
  })
})

describe('resolveFunnelStage — bentuk data rusak, tidak boleh melempar', () => {
  const brokenInputs: Array<[string, unknown]> = [
    ['null', null],
    ['undefined', undefined],
    ['array kosong', []],
    ['array berisi', ['bromo', 'ijen']],
    ['string', 'bromo'],
    ['string kosong', ''],
    ['angka', 42],
    ['nol', 0],
    ['boolean', true],
    ['NaN', Number.NaN],
    ['fungsi', () => 'bromo'],
    ['objek prototipe null', Object.create(null) as unknown],
  ]

  it.each(brokenInputs)('%s → MASUK tanpa melempar', (_name, value) => {
    expect(() => resolveFunnelStage({ tripBrief: value })).not.toThrow()
    expect(resolveFunnelStage({ tripBrief: value })).toBe('MASUK')
  })

  const wrongTypes: Array<[string, unknown, FunnelStage]> = [
    ['destination berupa angka', { destination: 12 }, 'MASUK'],
    ['destination berupa array', { destination: ['bromo'] }, 'MASUK'],
    ['destination berupa null', { destination: null }, 'MASUK'],
    ['destination string kosong', { destination: '   ' }, 'MASUK'],
    ['pax berupa string angka', { destination: 'bromo', pax: '4' }, 'ADA_TUJUAN'],
    ['pax nol', { destination: 'bromo', pax: 0 }, 'ADA_TUJUAN'],
    ['pax negatif', { destination: 'bromo', pax: -2 }, 'ADA_TUJUAN'],
    ['pax NaN', { destination: 'bromo', pax: Number.NaN }, 'ADA_TUJUAN'],
    ['pax Infinity', { destination: 'bromo', pax: Number.POSITIVE_INFINITY }, 'ADA_TUJUAN'],
    ['dateRange berupa objek', { destination: 'bromo', pax: 2, dateRange: { from: 'x' } }, 'ADA_ROMBONGAN'],
    ['dateRange string kosong', { destination: 'bromo', pax: 2, dateRange: '' }, 'ADA_ROMBONGAN'],
    ['dateRange null', { destination: 'bromo', pax: 2, dateRange: null }, 'ADA_ROMBONGAN'],
  ]

  it.each(wrongTypes)('%s → %s', (_name, value, expected) => {
    expect(() => resolveFunnelStage({ tripBrief: value })).not.toThrow()
    expect(resolveFunnelStage({ tripBrief: value })).toBe(expected)
  })
})

describe('resolveFunnelStage — monotonisitas terhadap kelengkapan', () => {
  // Nilai yang sah untuk setiap field TripBrief yang bisa menaikkan tahap. Setiap subset
  // dibandingkan dengan setiap subset yang memuatnya: menambah field tidak boleh menurunkan tahap.
  const fields: Array<[keyof TripBrief, unknown]> = [
    ['destination', 'bromo'],
    ['pax', 4],
    ['dateRange', '12-15 Sep 2026'],
    ['origin', 'Surabaya'],
    ['dayCount', 3],
    ['finishCity', 'bali'],
    ['lastTopic', 'price'],
    ['notes', 'honeymoon'],
    ['requestedTokens', ['bromo', 'ijen']],
    ['askedTripPreferences', true],
    ['declinedTripPreferences', true],
    ['awaitingTripPreferencesAnswer', true],
  ]

  const subsets: Array<{ mask: number; brief: Record<string, unknown> }> = []
  for (let mask = 0; mask < 1 << fields.length; mask++) {
    const brief: Record<string, unknown> = {}
    fields.forEach(([key, value], index) => {
      if (mask & (1 << index)) brief[key] = value
    })
    subsets.push({ mask, brief })
  }

  it(`menguji ${subsets.length} kombinasi field`, () => {
    expect(subsets).toHaveLength(4096)
  })

  it('menambah satu field tidak pernah menurunkan tahap', () => {
    const violations: string[] = []
    for (const { mask, brief } of subsets) {
      const current = funnelStageIndex(resolveFunnelStage({ tripBrief: brief }))
      for (let index = 0; index < fields.length; index++) {
        if (mask & (1 << index)) continue
        const [key, value] = fields[index]
        const richer = { ...brief, [key]: value }
        const next = funnelStageIndex(resolveFunnelStage({ tripBrief: richer }))
        if (next < current) violations.push(`${JSON.stringify(brief)} + ${String(key)}`)
      }
    }
    expect(violations).toEqual([])
  })

  it('brief terlengkap menghasilkan tahap tertinggi selain DITERUSKAN', () => {
    const fullest = Object.fromEntries(fields)
    expect(resolveFunnelStage({ tripBrief: fullest })).toBe('ADA_TANGGAL')
  })

  it('tahap tidak pernah melompati DITERUSKAN tanpa handoff', () => {
    for (const { brief } of subsets) {
      expect(resolveFunnelStage({ tripBrief: brief })).not.toBe('DITERUSKAN')
    }
  })
})

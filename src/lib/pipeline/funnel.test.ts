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
      'ADA_ASAL_LAMA',
      'ADA_KOTA_AKHIR',
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
    expect(funnelStageIndex('ADA_KOTA_AKHIR')).toBe(4)
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
    expect(stage({ declinedTripPreferences: true } satisfies TripBrief)).toBe('TANYA')
    expect(stage({ awaitingTripPreferencesAnswer: true } satisfies TripBrief)).toBe('TANYA')
    expect(stage({ origin: 'Surabaya', dayCount: 3 } satisfies TripBrief)).toBe('TANYA')
    expect(stage({ finishCity: 'bali' } satisfies TripBrief)).toBe('TANYA')
    expect(stage({ requestedTokens: ['bromo'] } satisfies TripBrief)).toBe('TANYA')
  })

  it('ADA_TUJUAN saat destination terisi', () => {
    expect(stage({ destination: 'bromo' } satisfies TripBrief)).toBe('ADA_TUJUAN')
  })

  it('ADA_ASAL_LAMA saat destination + origin + dayCount terisi', () => {
    expect(
      stage({ destination: 'bromo', origin: 'Surabaya', dayCount: 3 } satisfies TripBrief)
    ).toBe('ADA_ASAL_LAMA')
  })

  it('ADA_KOTA_AKHIR saat destination + origin + dayCount + finishCity lengkap', () => {
    expect(
      stage({
        destination: 'bromo',
        origin: 'Surabaya',
        dayCount: 3,
        finishCity: 'bali',
      } satisfies TripBrief)
    ).toBe('ADA_KOTA_AKHIR')
  })

  it('DITERUSKAN menang atas tahap kelengkapan apa pun', () => {
    expect(stage({}, true)).toBe('DITERUSKAN')
    expect(stage({ destination: 'ijen' } satisfies TripBrief, true)).toBe('DITERUSKAN')
    expect(
      stage(
        {
          destination: 'ijen',
          origin: 'Bali',
          dayCount: 2,
          finishCity: 'surabaya',
        } satisfies TripBrief,
        true
      )
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

describe('resolveFunnelStage — anak tangga tidak bisa dilompati', () => {
  // Anak tangga ADA_ASAL_LAMA menuntut KEDUANYA. Satu saja tidak cukup: kalau `origin` sendirian
  // sudah menaikkan tahap, funnel akan mengklaim tahu lama perjalanan yang belum pernah disebut.
  it('origin terisi tapi dayCount kosong tetap ADA_TUJUAN', () => {
    expect(stage({ destination: 'bromo', origin: 'Surabaya' } satisfies TripBrief)).toBe(
      'ADA_TUJUAN'
    )
  })

  it('dayCount terisi tapi origin kosong tetap ADA_TUJUAN', () => {
    expect(stage({ destination: 'bromo', dayCount: 3 } satisfies TripBrief)).toBe('ADA_TUJUAN')
  })

  it('finishCity tanpa origin/dayCount tidak melompati ADA_ASAL_LAMA', () => {
    expect(stage({ destination: 'bromo', finishCity: 'bali' } satisfies TripBrief)).toBe(
      'ADA_TUJUAN'
    )
    expect(
      stage({ destination: 'bromo', origin: 'Surabaya', finishCity: 'bali' } satisfies TripBrief)
    ).toBe('ADA_TUJUAN')
  })

  it('tanpa destination, sekelengkap apa pun sisanya tetap TANYA', () => {
    expect(
      stage({ origin: 'Surabaya', dayCount: 3, finishCity: 'bali' } satisfies TripBrief)
    ).toBe('TANYA')
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

  const withOriginDay = { destination: 'bromo', origin: 'Surabaya', dayCount: 3 }
  const wrongTypes: Array<[string, unknown, FunnelStage]> = [
    ['destination berupa angka', { destination: 12 }, 'MASUK'],
    ['destination berupa array', { destination: ['bromo'] }, 'MASUK'],
    ['destination berupa null', { destination: null }, 'MASUK'],
    ['destination string kosong', { destination: '   ' }, 'MASUK'],
    ['origin berupa angka', { destination: 'bromo', origin: 12, dayCount: 3 }, 'ADA_TUJUAN'],
    ['origin string kosong', { destination: 'bromo', origin: '  ', dayCount: 3 }, 'ADA_TUJUAN'],
    ['origin null', { destination: 'bromo', origin: null, dayCount: 3 }, 'ADA_TUJUAN'],
    [
      'dayCount berupa string angka',
      { destination: 'bromo', origin: 'Surabaya', dayCount: '3' },
      'ADA_TUJUAN',
    ],
    ['dayCount nol', { destination: 'bromo', origin: 'Surabaya', dayCount: 0 }, 'ADA_TUJUAN'],
    ['dayCount negatif', { destination: 'bromo', origin: 'Surabaya', dayCount: -2 }, 'ADA_TUJUAN'],
    [
      'dayCount NaN',
      { destination: 'bromo', origin: 'Surabaya', dayCount: Number.NaN },
      'ADA_TUJUAN',
    ],
    [
      'dayCount Infinity',
      { destination: 'bromo', origin: 'Surabaya', dayCount: Number.POSITIVE_INFINITY },
      'ADA_TUJUAN',
    ],
    ['finishCity berupa objek', { ...withOriginDay, finishCity: { city: 'bali' } }, 'ADA_ASAL_LAMA'],
    ['finishCity string kosong', { ...withOriginDay, finishCity: '' }, 'ADA_ASAL_LAMA'],
    ['finishCity null', { ...withOriginDay, finishCity: null }, 'ADA_ASAL_LAMA'],
    ['requestedTokens berisi non-string', { requestedTokens: [1, 2] }, 'MASUK'],
    ['requestedTokens array kosong', { requestedTokens: [] }, 'MASUK'],
    ['flag preferensi bernilai false', { askedTripPreferences: false }, 'MASUK'],
  ]

  it.each(wrongTypes)('%s → %s', (_name, value, expected) => {
    expect(() => resolveFunnelStage({ tripBrief: value })).not.toThrow()
    expect(resolveFunnelStage({ tripBrief: value })).toBe(expected)
  })
})

describe('resolveFunnelStage — monotonisitas terhadap kelengkapan', () => {
  // Setiap field TripBrief yang benar-benar ditulis orchestrator lewat `persistTripBrief` dan
  // bisa menaikkan tahap, dengan satu nilai yang sah. Setiap subset dibandingkan dengan setiap
  // subset yang memuatnya: menambah field tidak boleh menurunkan tahap.
  const fields: Array<[keyof TripBrief, unknown]> = [
    ['destination', 'bromo'],
    ['origin', 'Surabaya'],
    ['dayCount', 3],
    ['finishCity', 'bali'],
    ['lastTopic', 'price'],
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
    expect(subsets).toHaveLength(512)
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
    expect(resolveFunnelStage({ tripBrief: fullest })).toBe('ADA_KOTA_AKHIR')
  })

  it('tahap tidak pernah melompati DITERUSKAN tanpa handoff', () => {
    for (const { brief } of subsets) {
      expect(resolveFunnelStage({ tripBrief: brief })).not.toBe('DITERUSKAN')
    }
  })

  it('setiap tahap selain DITERUSKAN benar-benar terjangkau oleh kombinasi field', () => {
    const reached = new Set(
      subsets.map(({ brief }) => resolveFunnelStage({ tripBrief: brief }))
    )
    expect([...reached].sort()).toEqual(
      ['ADA_ASAL_LAMA', 'ADA_KOTA_AKHIR', 'ADA_TUJUAN', 'MASUK', 'TANYA'].sort()
    )
  })
})

import { describe, it, expect } from 'vitest'
import { buildScheduleNote } from './schedule-note'
import type { BookingData } from '@/lib/booking/client'
import type { ReviewPoint } from '@/lib/daily-summary/payload-schema'

const AT = new Date('2026-11-12T05:00:00.000Z')

const booking: BookingData = {
  id: 'JVTO-3885',
  package: '5 Day Ijen, Papuma Beach, Tumpak Sewu & Bromo Discovery from Bali to Surabaya',
  total_pax: 2,
  pickup: { meeting_point: 'Surabaya Airport', meeting_point_value: 'Terminal 2 SQ922', pickup_time: '09:10' },
  dropoff: { drop_point: 'Bali Hotel', drop_point_value: 'Some Resort' },
  hotels: [{ hotel: 'Manis Ae Cabin & Resto Bromo' }, { hotel: 'Riverside Homestay' }],
}

const p = (teks: string, jenis: ReviewPoint extends string ? never : 'kebutuhan' | 'keputusan' | 'trip' | 'jemput' | 'lokasi' | 'bayar' | 'komplain'): ReviewPoint => ({ teks, jenis })

function lines(points: ReviewPoint[], b: BookingData | null = booking): string[] {
  return buildScheduleNote({ poinPenting: points }, b, AT)?.baris ?? []
}

describe('buildScheduleNote', () => {
  it('menyimpan hal dari tamu yang belum punya tempat di Schedule (contoh note nyata Agu-Nov)', () => {
    const out = lines([
      p('Strict vegetarian, satu orang tidak makan daging', 'kebutuhan'),
      p('Gluten free diet', 'kebutuhan'),
      p('Minta kue ulang tahun saat sarapan', 'kebutuhan'),
      p('Request kuda Bromo dan ATV', 'keputusan'),
      p('Skip city tour, ganti Madakaripura hari pertama', 'trip'),
    ])
    expect(out).toHaveLength(5)
    expect(out[0]).toContain('vegetarian')
  })

  it('PEMERIKSA ANTI-DOBEL: tidak pernah memuat jemput/antar, hotel, tanggal, pax, kaos, lokasi, uang, atau komplain', () => {
    const dobel: ReviewPoint[] = [
      p('Jemput di bandara jam 10.00', 'kebutuhan'),
      p('Pickup dari Malang', 'trip'),
      p('Antar ke stasiun Gubeng', 'keputusan'),
      p('Hotel Artotel Bromo dipesan sendiri', 'kebutuhan'),
      p('Upgrade ke Manis Ae', 'keputusan'),
      p('Tamu menginap di Riverside', 'kebutuhan'),
      p('Tanggal trip bergeser ke 10 Desember', 'trip'),
      p('Rombongan jadi 3 pax', 'kebutuhan'),
      p('Ukuran kaos XL x 2', 'kebutuhan'),
      p('Titik jemput di Terminal 2', 'jemput'),
      p('Bandara Juanda', 'lokasi'),
      p('Tagihan cash 1.100.000', 'bayar'),
      p('Tamu kecewa dengan sopir', 'komplain'),
      p('Tamu menolak membayar DP', 'kebutuhan'),
    ]
    expect(lines(dobel)).toEqual([])
  })

  it('membuang baris yang hanya mengulang nilai data booking walau tanpa kata topik', () => {
    expect(lines([p('Manis Ae Cabin', 'keputusan'), p('Tumpak Sewu Bromo Discovery', 'trip')])).toEqual([])
  })

  it('membuang baris yang menyebut nama khas hotel booking walau tanpa kata hotel', () => {
    const b: BookingData = { ...booking, hotels: [{ hotel: 'Artha Cottage' }] }
    expect(lines([p('Skip papuma, langsung Artha', 'keputusan'), p('Request kuda Bromo', 'keputusan')], b)).toEqual(['Request kuda Bromo'])
  })

  it('membuang yang sudah ditulis admin di note Schedule', () => {
    const withAdmin: BookingData = { ...booking, notes: '- Gluten free diet\n- Driver: Egy' }
    expect(lines([p('Gluten free diet', 'kebutuhan'), p('Vegetarian 1 pax', 'kebutuhan')], withAdmin)).toEqual(['Vegetarian 1 pax'])
  })

  it('membuang nominal dari kalimat yang selebihnya berguna dan menolak yang soal pembayaran', () => {
    expect(lines([p('Add on carnivore feeding (biaya IDR 2jt)', 'keputusan')])).toEqual(['Add on carnivore feeding'])
    expect(lines([p('Tamu minta diskon untuk add on drone', 'keputusan')])).toEqual([])
  })

  it('poin lama tanpa jenis tidak ikut, string polos diabaikan', () => {
    expect(lines(['Vegetarian', { teks: 'Alergi kacang' }])).toEqual([])
  })

  it('maksimal lima baris, tanpa duplikat, baris panjang dipotong', () => {
    const many = Array.from({ length: 8 }, (_, i) => p(`Permintaan khusus nomor ${i} drone foto`, 'keputusan'))
    expect(lines([...many, p('Permintaan khusus nomor 0 drone foto', 'keputusan')])).toHaveLength(5)
    const long = lines([p(`Alergi kacang ${'berat '.repeat(60)}`, 'kebutuhan')])
    expect(long[0].length).toBeLessThanOrEqual(160)
  })

  it('tanpa booking tidak menghasilkan apa pun; tanpa baris layak mengembalikan null', () => {
    expect(buildScheduleNote({ poinPenting: [p('Vegetarian', 'kebutuhan')] }, null, AT)).toBeNull()
    expect(buildScheduleNote({ poinPenting: [] }, booking, AT)).toBeNull()
    expect(buildScheduleNote({ poinPenting: [p('Vegetarian', 'kebutuhan')] }, booking, AT)?.diperbaruiAt).toBe(AT.toISOString())
  })
})

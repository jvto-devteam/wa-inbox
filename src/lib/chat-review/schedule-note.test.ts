import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/bot/llm', () => ({ callLLM: vi.fn() }))

import { callLLM } from '@/lib/bot/llm'
import { generateScheduleNote, parseScheduleNote, scheduleNoteCandidates } from './schedule-note'
import type { BookingData } from '@/lib/booking/client'
import type { ReviewPoint } from '@/lib/daily-summary/payload-schema'

const AT = new Date('2026-11-13T05:00:00.000Z')
type Kind = 'kebutuhan' | 'keputusan' | 'trip' | 'jemput' | 'lokasi' | 'bayar' | 'komplain'
const p = (teks: string, jenis: Kind): ReviewPoint => ({ teks, jenis })
const cands = (points: ReviewPoint[]) => scheduleNoteCandidates({ poinPenting: points })

const booking: BookingData = {
  id: 'JVTO-3885',
  package: '5 Day Ijen, Papuma Beach, Tumpak Sewu & Bromo Discovery',
  total_pax: 2,
  pickup: { meeting_point: 'Surabaya Airport', meeting_point_value: 'Terminal 2 SQ922' },
  dropoff: { drop_point: 'Bali Hotel', drop_point_value: 'Some Resort' },
  hotels: [{ hotel: 'Manis Ae Cabin & Resto Bromo' }, { hotel: 'Artha Cottage' }],
}
const parse = (lines: unknown, b: BookingData | null = booking) => parseScheduleNote(JSON.stringify({ baris: lines }), b, null, AT)?.baris

beforeEach(() => vi.mocked(callLLM).mockReset())

describe('scheduleNoteCandidates (saringan awal sebelum LLM)', () => {
  it('meloloskan kebutuhan/permintaan tamu dari contoh produksi', () => {
    const out = cands([
      p('Satu orang peserta adalah vegetarian.', 'kebutuhan'),
      p('Tamu meminta kepastian AC mobil dingin.', 'kebutuhan'),
      p('Satu orang teman tiba dengan penerbangan berbeda (QZ321), dua orang lainnya tetap dengan SQ', 'kebutuhan'),
      p('Tamu membutuhkan internet stabil untuk rapat online pada 3 Nov pukul 15:00 waktu Bali; tim menyarankan kafe', 'keputusan'),
    ])
    expect(out).toHaveLength(4)
  })

  it('PEMERIKSA ANTI-DOBEL: jemput/antar, hotel, kamar, tanggal, kaos, lokasi, uang, batal, komplain tidak lolos', () => {
    const dobel: ReviewPoint[] = [
      p('Jemput di bandara jam 10.00', 'kebutuhan'),
      p('Pickup dari Malang', 'trip'),
      p('Hotel Artotel Bromo dipesan sendiri', 'kebutuhan'),
      p('Tamu minta 6 kamar: 4 twin bed dan 2 double bed', 'kebutuhan'),
      p('Meminta 2 kamar dengan Twin Beds untuk 4 malam', 'kebutuhan'),
      p('Tanggal trip bergeser ke 10 Desember', 'trip'),
      p('Rombongan jadi 3 pax', 'kebutuhan'),
      p('Ukuran kaos XL x 2', 'kebutuhan'),
      p('Titik jemput di Terminal 2', 'jemput'),
      p('Bandara Juanda', 'lokasi'),
      p('Tagihan cash 1.100.000', 'bayar'),
      p('Tamu kecewa dengan sopir', 'komplain'),
      p('Tamu batal berangkat; tim memberi kredit perjalanan', 'keputusan'),
      p('Tamu menanyakan apakah tur privat atau gabung grup', 'kebutuhan'),
      p('Tamu menanyakan suhu malam di Bromo', 'kebutuhan'),
      p('Solo traveler, dewasa', 'kebutuhan'),
      p('2 pax dewasa', 'kebutuhan'),
      p('Bawa daypack; koper besar dititipkan', 'kebutuhan'),
      p('Siapkan jaket hangat, sepatu tertutup, dan headlamp', 'kebutuhan'),
      p('Tamu memberi review sangat positif untuk guide dan driver', 'keputusan'),
      p('Tamu meminta titik akhir tour dipindah ke Surabaya', 'keputusan'),
    ]
    expect(cands(dobel)).toEqual([])
  })

  it('komposisi rombongan yang disertai kebutuhan nyata tetap lolos', () => {
    expect(cands([p('Keluarga dengan anak 3 tahun, butuh child seat', 'kebutuhan')])).toHaveLength(1)
    expect(parse(['Solo traveler, butuh guide berbahasa Inggris'])).toEqual(['Solo traveler, butuh guide berbahasa Inggris'])
  })

  it('poin lama tanpa jenis dan string polos tidak ikut; maksimal delapan kandidat tanpa duplikat', () => {
    expect(cands(['Vegetarian', { teks: 'Alergi kacang' }])).toEqual([])
    const many = Array.from({ length: 12 }, (_, i) => p(`Permintaan khusus nomor ${i} drone foto`, 'keputusan'))
    expect(cands([...many, many[0]])).toHaveLength(8)
  })

  it('membuang nominal dari kalimat yang selebihnya berguna', () => {
    expect(cands([p('Add on carnivore feeding (biaya IDR 2jt)', 'keputusan')])).toEqual(['Add on carnivore feeding'])
  })
})

describe('parseScheduleNote (saringan keluaran LLM)', () => {
  it('menerima poin pendek seperti contoh pemilik', () => {
    expect(parse(['1 orang vegan', 'Minta AC mobil dingin', '1 orang penerbangan beda (QZ321)', 'Perlu internet stabil, rapat online 3 Nov 15:00 WITA'])).toEqual([
      '1 orang vegan',
      'Minta AC mobil dingin',
      '1 orang penerbangan beda (QZ321)',
      'Perlu internet stabil, rapat online 3 Nov 15:00 WITA',
    ])
  })

  it('PEMERIKSA ANTI-DOBEL pada keluaran: topik Schedule, nama hotel/titik booking, uang, kontak dibuang', () => {
    expect(
      parse([
        'Minta twin bed',
        '2 kamar double',
        'Jemput jam 10',
        'Upgrade ke Manis Ae',
        'Langsung ke Artha',
        'Turun di Surabaya Airport',
        'Tagihan cash',
        'Refund 1 pax',
        'Hubungi tamu 0812-3456-7890',
        'Rombongan jadi 3 pax',
        'Solo traveler, dewasa',
        'Bawa daypack dan jaket',
        'Review positif: guide Gufron',
        'Minta titik akhir tour di Surabaya',
      ]),
    ).toEqual([])
  })

  it('maksimal lima poin, tanpa duplikat, titik akhir dibuang, baris panjang dipotong', () => {
    const out = parse(['Vegan.', 'vegan', ...Array.from({ length: 8 }, (_, i) => `Minta drone ${i}`), `Alergi ${'kacang '.repeat(30)}`])
    expect(out).toHaveLength(5)
    expect(out?.[0]).toBe('Vegan')
    expect(parse([`Alergi ${'kacang '.repeat(30)}`])?.[0].length).toBeLessThanOrEqual(80)
  })

  it('JSON dibungkus code fence diterima; bentuk salah mengembalikan null; daftar kosong sah', () => {
    expect(parseScheduleNote('```json\n{"baris":["Vegan"]}\n```', booking, null, AT)?.baris).toEqual(['Vegan'])
    expect(parseScheduleNote('bukan json', booking, null, AT)).toBeNull()
    expect(parseScheduleNote('{"baris":"Vegan"}', booking, null, AT)).toBeNull()
    expect(parseScheduleNote('{"baris":[]}', booking, null, AT)?.baris).toEqual([])
  })
})

describe('generateScheduleNote', () => {
  const args = { booking, bookingContext: '- Kode: JVTO-3885', contactName: null, model: undefined, at: AT }

  it('tanpa kandidat: note kosong tanpa memanggil LLM', async () => {
    const note = await generateScheduleNote({ ...args, review: { poinPenting: [p('Jemput di bandara', 'jemput')] } })
    expect(note?.baris).toEqual([])
    expect(callLLM).not.toHaveBeenCalled()
  })

  it('mengirim kandidat dan data booking ke LLM lalu menyaring hasilnya', async () => {
    vi.mocked(callLLM).mockResolvedValue('{"baris":["1 orang vegetarian","Minta twin bed"]}')
    const note = await generateScheduleNote({ ...args, review: { poinPenting: [p('Satu orang peserta adalah vegetarian.', 'kebutuhan')] } })
    expect(note?.baris).toEqual(['1 orang vegetarian'])
    const prompt = vi.mocked(callLLM).mock.calls[0][0]
    expect(prompt).toContain('Satu orang peserta adalah vegetarian.')
    expect(prompt).toContain('JVTO-3885')
  })

  it('LLM gagal atau keluaran rusak: null (pemanggil mempertahankan note lama), tidak melempar', async () => {
    const review = { poinPenting: [p('Satu orang peserta adalah vegetarian.', 'kebutuhan')] }
    vi.mocked(callLLM).mockRejectedValueOnce(new Error('timeout'))
    expect(await generateScheduleNote({ ...args, review })).toBeNull()
    vi.mocked(callLLM).mockResolvedValueOnce('maaf')
    expect(await generateScheduleNote({ ...args, review })).toBeNull()
  })
})

// Golden-set untuk ekstraktor sinyal booking (src/lib/booking-actions/extract.ts), dijalankan
// oleh `npm run eval` bersama kasus balasan bot. Berbeda dari EVAL_CASES: yang diukur bukan teks
// balasan tetapi hasil ekstraksi, jadi tidak butuh database -- hanya Ollama. Pesan ditulis
// seperti pola chat tamu JVTO yang nyata (campuran Indonesia/Inggris singkat).

import type { BookingData } from '@/lib/booking/client'
import type { FieldKey } from '@/lib/booking-actions/fields'

export type ExtractionExpectation = { field: FieldKey; value?: string }

export type ExtractionCase = {
  id: string
  /** Pesan tamu (INBOUND) saja, urut; baris ke-i diberi nomor #i. */
  guestMessages: string[]
  booking: BookingData
  /** Tiap entri harus ada di `changes` (value, bila ada, harus sama persis). */
  expectChanges: ExtractionExpectation[]
  /** Tiap entri harus ada di `facts`. */
  expectFacts: ExtractionExpectation[]
  /** Bila true: `changes` dan `facts` harus kosong. */
  expectNone?: boolean
  source: string
}

const SURABAYA_BOOKING: BookingData = {
  total_pax: 2,
  date: { start_ymd: '2026-11-03', end_ymd: '2026-11-05' },
  pickup: { meeting_point: 'Surabaya Airport', meeting_point_arrival: '', meeting_point_value: '', pickup_time: '09:00' },
  dropoff: { drop_point: 'Surabaya Airport', drop_point_arrival: '', drop_point_value: '', drop_time: '17:00' },
  hotels: [],
  tshirtSize: '',
}

export const EXTRACTION_CASES: ExtractionCase[] = [
  {
    id: 'extract-change-pickup-airport-to-hotel',
    guestMessages: ['Kak, bisa jemputnya diganti dari bandara ke hotel saja? Kami menginap di Surabaya.'],
    booking: SURABAYA_BOOKING,
    expectChanges: [{ field: 'pickup_point', value: 'Surabaya Hotel' }],
    expectFacts: [],
    source: 'this plan, Task 2 (contoh owner 2026-10-19: Surabaya Airport -> Surabaya Hotel)',
  },
  {
    id: 'extract-fact-flight-number',
    guestMessages: ['Hi, our flight is GA 312 landing at 14.10 at Juanda'],
    booking: SURABAYA_BOOKING,
    expectChanges: [],
    expectFacts: [{ field: 'pickup_arrival' }],
    source: 'this plan, Task 2 (tamu menyatakan nomor flight; spec §5.3a)',
  },
  {
    id: 'extract-fact-pax-berlima',
    guestMessages: ['Oh iya kak, kami berlima ya yang berangkat'],
    booking: SURABAYA_BOOKING,
    expectChanges: [],
    expectFacts: [{ field: 'total_pax', value: '5' }],
    source: 'this plan, Task 2 (tamu menyatakan jumlah orang; review focus #3)',
  },
  {
    id: 'extract-change-tshirt-2xl-ambigu-pax-3',
    guestMessages: ['Kak tolong ubah kaos jadi 2xl 1m ya'],
    booking: { ...SURABAYA_BOOKING, total_pax: 3, tshirtSize: 'M x 3' },
    // "2xl" ambigu (2 x XL atau satu 2XL); pax 3 => 2 x XL + 1 M. Bentuk kanonik urut M dulu.
    expectChanges: [{ field: 'tshirt_sizes', value: 'M x 1, XL x 2' }],
    expectFacts: [],
    source: 'owner 2026-10-20 ("ubah kaos jadi 2xl 1m"; total_pax sebagai petunjuk)',
  },
  {
    id: 'extract-none-pleasantries',
    guestMessages: ['Terima kasih banyak kak, sampai ketemu di Surabaya!', '👍'],
    booking: SURABAYA_BOOKING,
    expectChanges: [],
    expectFacts: [],
    expectNone: true,
    source: 'this plan, Task 2 (basa-basi tanpa sinyal tidak boleh menghasilkan apa pun)',
  },
]

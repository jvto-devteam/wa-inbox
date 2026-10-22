import { describe, expect, it } from 'vitest'
import type { BookingData } from '@/lib/booking/client'
import { bookingContextForReview } from './booking-context'

describe('bookingContextForReview', () => {
  it('ringkas, daftar putih saja; jam 07:00 = jam belum ada; tanpa keuangan/kontak', () => {
    const b = {
      id: 'JVTO-3752', package: 'Bromo Ijen', duration: '3D2N', date: { start_ymd: '2027-01-01', end_ymd: '2027-01-03' }, total_pax: 2,
      pickup: { meeting_point: 'Surabaya Hotel', meeting_point_value: 'Hotel 88', pickup_time: '07:00' },
      dropoff: { drop_point: 'Surabaya Airport', drop_point_value: 'GA 300', drop_time: '16:00' },
      tshirtSize: 'L x 2', financial: { payment: 100, balance: 5 }, guestDetails: { email: 'x@y.z', phone: '+62' },
    } as unknown as BookingData
    const text = bookingContextForReview(b)
    expect(text).toBe(
      [
        '- Kode: JVTO-3752', '- Paket: Bromo Ijen', '- Durasi: 3D2N', '- Tanggal: 2027-01-01 s/d 2027-01-03', '- Pax: 2',
        '- Jemput: Surabaya Hotel · Hotel 88 · jam belum ada', '- Antar: Surabaya Airport · GA 300 · 16:00', '- Kaos: L x 2',
      ].join('\n')
    )
    expect(text).not.toMatch(/x@y|balance|payment|\+62/)
  })

  it('tanpa booking -> null', () => {
    expect(bookingContextForReview(null)).toBeNull()
    expect(bookingContextForReview({} as BookingData)).toBeNull()
  })
})

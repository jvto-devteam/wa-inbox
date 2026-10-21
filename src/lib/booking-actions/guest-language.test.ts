import { describe, expect, it } from 'vitest'
import type { BookingData } from '@/lib/booking/client'
import { guestLanguage, textLanguage } from './guest-language'

const indonesianBooking = { guestDetails: { country: 'Indonesia' } } as unknown as BookingData
const foreignBooking = { guestDetails: { country: 'China' } } as unknown as BookingData

describe('textLanguage', () => {
  it('chat Inggris (uji owner 2026-10-21) -> en', () => {
    expect(textLanguage(['Hello, just want to confirm if my pickup location is hotel 88 surabaya at 10:00 am'])).toBe('en')
    expect(textLanguage(['please change the t-shirt sizes to XL x 2, M x 1'])).toBe('en')
  })

  it('chat Indonesia -> id', () => {
    expect(textLanguage(['tolong ganti jemput di hotel 88 surabaya jam 10'])).toBe('id')
    expect(textLanguage(['kaos saya ubah jadi XL x 2 ya kak'])).toBe('id')
  })

  it('tidak jelas (hanya nama tempat / angka / kosong) -> null', () => {
    expect(textLanguage(['hotel 88 surabaya 10:00'])).toBeNull()
    expect(textLanguage([])).toBeNull()
    expect(textLanguage([null, undefined, ''])).toBeNull()
  })
})

describe('guestLanguage', () => {
  it('bahasa chat menang atas negara di booking', () => {
    expect(guestLanguage(indonesianBooking, ['Hello, just want to confirm my pickup time'])).toBe('en')
    expect(guestLanguage(foreignBooking, ['tolong ganti jam jemput'])).toBe('id')
  })

  it('chat tidak jelas -> negara di booking', () => {
    expect(guestLanguage(indonesianBooking, ['hotel 88 surabaya'])).toBe('id')
    expect(guestLanguage(foreignBooking)).toBe('en')
  })
})

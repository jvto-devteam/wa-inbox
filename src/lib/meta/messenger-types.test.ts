import { describe, it, expect } from 'vitest'
import { isMessengerPayload } from './messenger-types'

// isMessengerPayload adalah gerbang runtime, bukan sekadar tipe: ia yang menentukan payload
// webhook mana masuk jalur Messenger/Instagram (entry[].messaging[]) vs jalur WhatsApp
// (entry[].changes[].value.messages[]). Payload WhatsApp genuine punya object
// 'whatsapp_business_account' -- kalau gerbang ini pernah salah menganggapnya Messenger,
// setiap pesan WhatsApp akan lolos verifikasi signature lalu diproses lewat parser yang
// salah dan dibuang diam-diam.
describe('isMessengerPayload', () => {
  it('true untuk object "page"', () => {
    expect(isMessengerPayload({ object: 'page', entry: [] })).toBe(true)
  })

  it('true untuk object "instagram"', () => {
    expect(isMessengerPayload({ object: 'instagram', entry: [] })).toBe(true)
  })

  it('false untuk object "whatsapp_business_account"', () => {
    expect(isMessengerPayload({ object: 'whatsapp_business_account', entry: [] })).toBe(false)
  })

  it('false untuk null', () => {
    expect(isMessengerPayload(null)).toBe(false)
  })

  it('false untuk undefined', () => {
    expect(isMessengerPayload(undefined)).toBe(false)
  })

  it('false untuk objek tanpa field object', () => {
    expect(isMessengerPayload({ entry: [] })).toBe(false)
  })
})

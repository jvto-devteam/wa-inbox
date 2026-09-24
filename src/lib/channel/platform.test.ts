import { describe, it, expect } from 'vitest'
import { hasPhoneNumber, ALL_PLATFORMS } from './platform'

describe('hasPhoneNumber', () => {
  it('hanya WhatsApp yang identitasnya nomor telepon', () => {
    expect(hasPhoneNumber('WHATSAPP')).toBe(true)
    expect(hasPhoneNumber('INSTAGRAM')).toBe(false)
    expect(hasPhoneNumber('FACEBOOK')).toBe(false)
    expect(hasPhoneNumber('EMAIL')).toBe(false)
  })

  // Penjaga: kalau platform kelima ditambahkan tapi hasPhoneNumber tidak diperbarui,
  // filter nomor Indonesia akan tampak menyala di platform itu tapi diam-diam tidak
  // melakukan apa-apa -- persis kegagalan senyap yang tabel ini ada untuk mencegah.
  it('menjawab setiap nilai Platform yang ada', () => {
    expect(ALL_PLATFORMS).toHaveLength(4)
    for (const p of ALL_PLATFORMS) expect(typeof hasPhoneNumber(p)).toBe('boolean')
  })
})

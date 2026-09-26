import { describe, it, expect } from 'vitest'
import { hasPhoneNumber, ALL_PLATFORMS, SHIPPED_PLATFORMS, PLATFORM_LABEL } from './platform'

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

describe('SHIPPED_PLATFORMS', () => {
  // Tab kosong lebih buruk daripada tidak ada tab (lihat komentar di platform.ts). Test ini
  // gagal keras kalau seseorang menambahkan Instagram atau Email ke daftar tab sebelum
  // fasenya benar-benar selesai -- "supaya rapi" tidak boleh mengalahkan aturan ini diam-diam.
  it('hanya memuat platform yang fasenya sudah selesai (belum termasuk Email)', () => {
    expect(SHIPPED_PLATFORMS).toEqual(['WHATSAPP', 'FACEBOOK', 'INSTAGRAM'])
    expect(SHIPPED_PLATFORMS).not.toContain('EMAIL')
  })

  it('PLATFORM_LABEL memuat label untuk keempat platform, termasuk yang belum di-tab-kan', () => {
    for (const p of ALL_PLATFORMS) expect(typeof PLATFORM_LABEL[p]).toBe('string')
  })
})

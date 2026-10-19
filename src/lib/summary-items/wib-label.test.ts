import { describe, expect, it } from 'vitest'
import { wibDateTimeLabel } from './status'

describe('wibDateTimeLabel', () => {
  it('bentuk lengkap dan ringkas', () => {
    expect(wibDateTimeLabel('2026-10-19T02:12:00.000Z')).toMatch(/09\.12 WIB$/)
    expect(wibDateTimeLabel('2026-10-19T02:12:00.000Z', { compact: true })).toBe('19 Okt 09.12')
  })

  it('tengah malam WIB tampil 00.xx, bukan 24.xx', () => {
    // 2026-10-18T17:05Z = 19 Okt 00.05 WIB
    expect(wibDateTimeLabel('2026-10-18T17:05:00.000Z', { compact: true })).toBe('19 Okt 00.05')
    expect(wibDateTimeLabel('2026-10-18T17:05:00.000Z')).toContain('00.05')
  })
})

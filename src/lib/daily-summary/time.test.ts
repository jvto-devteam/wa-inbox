import { describe, expect, it } from 'vitest'
import { isDateKey, jakartaDayKey, jakartaDayRange, previousJakartaDayKey } from './time'

describe('jakartaDayRange', () => {
  it('menempatkan 00:00 WIB di 17:00 UTC hari sebelumnya', () => {
    const { start, end } = jakartaDayRange('2026-09-21')
    expect(start.toISOString()).toBe('2026-09-20T17:00:00.000Z')
    expect(end.toISOString()).toBe('2026-09-21T17:00:00.000Z')
  })

  it('menolak tanggal yang tidak ada', () => {
    expect(() => jakartaDayRange('2026-02-30')).toThrow()
    expect(isDateKey('2026-9-1')).toBe(false)
  })
})

describe('jakartaDayKey', () => {
  it('23:59 WIB masih hari itu, 00:00 WIB sudah hari berikutnya', () => {
    expect(jakartaDayKey(new Date('2026-09-21T16:59:59Z'))).toBe('2026-09-21')
    expect(jakartaDayKey(new Date('2026-09-21T17:00:00Z'))).toBe('2026-09-22')
  })
})

describe('previousJakartaDayKey', () => {
  it('cron 17:00 UTC (00:00 WIB) meringkas hari yang baru selesai', () => {
    expect(previousJakartaDayKey(new Date('2026-09-21T17:00:30Z'))).toBe('2026-09-21')
  })

  it('siang WIB tetap menunjuk kemarin', () => {
    expect(previousJakartaDayKey(new Date('2026-09-22T05:00:00Z'))).toBe('2026-09-21')
  })
})

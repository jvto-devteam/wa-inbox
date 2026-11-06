/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { isUpcoming, todayWib } from './backfill-crew-notes'

describe('todayWib', () => {
  it('memakai tanggal WIB, bukan UTC', () => {
    expect(todayWib(new Date('2026-11-06T20:00:00Z'))).toBe('2026-11-07') // 03:00 WIB
    expect(todayWib(new Date('2026-11-06T16:59:00Z'))).toBe('2026-11-06') // 23:59 WIB
  })
})

describe('isUpcoming', () => {
  const today = '2026-11-07'
  it('trip yang belum selesai (end_ymd hari ini atau lebih)', () => {
    expect(isUpcoming({ date: { start_ymd: '2026-11-05', end_ymd: '2026-11-07' } }, today)).toBe(true)
    expect(isUpcoming({ date: { start_ymd: '2026-11-20', end_ymd: '2026-11-23' } }, today)).toBe(true)
  })
  it('trip yang sudah selesai atau tanpa data tanggal', () => {
    expect(isUpcoming({ date: { start_ymd: '2026-11-01', end_ymd: '2026-11-03' } }, today)).toBe(false)
    expect(isUpcoming({}, today)).toBe(false)
    expect(isUpcoming(null, today)).toBe(false)
    expect(isUpcoming('teks', today)).toBe(false)
  })
  it('tanpa end_ymd memakai start_ymd', () => {
    expect(isUpcoming({ date: { start_ymd: '2026-11-09' } }, today)).toBe(true)
    expect(isUpcoming({ date: { start_ymd: '2026-11-02' } }, today)).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { buildReport, mondayOf, periodRange } from './report'
import { reportRows } from './report-mock'

describe('data contoh laporan', () => {
  // Selasa dan Senin: minggu ini selalu berisi inquiry, lead beralasan AI, dan booking dari chat.
  it.each(['2026-11-24', '2026-11-23'])('minggu ini berisi (hari ini %s)', (today) => {
    const { from, to } = periodRange('minggu-ini', today)
    const r = buildReport(reportRows(today), from, to, 8, today)
    expect(r.inquiries).toBeGreaterThan(0)
    expect(r.bookings.length).toBeGreaterThan(0)
    expect(r.leads.some((l) => l.sumber === 'ai' && l.rekomendasi)).toBe(true)
    expect(r.leads.some((l) => l.lastFrom === 'tamu')).toBe(true)
    // tamu lama dan vendor tidak pernah jadi lead
    expect(r.leads.map((l) => l.name)).not.toContain('Sarah M.')
    expect(r.leads.map((l) => l.name)).not.toContain('Vendor Transport Bali')
    expect(r.trend.every((w) => w.inquiries > 0)).toBe(true)
    expect(r.trend[7].from).toBe(mondayOf(today))
  })
})

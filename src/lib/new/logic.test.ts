import { describe, expect, it } from 'vitest'
import { dayMatch, monthCells, parseR, rLabel, whenLabel } from './dates'
import { accuracy, antreanTotal, draftOf, filterConvs, inboxBadge, rData } from './logic'
import { AGS, AGT, initialState } from './mock-data'

const T0 = new Date(2026, 10, 24) // 24 Nov 2026

describe('dates', () => {
  it('parseR membaca rentang dan menolak label biasa', () => {
    expect(parseR('r:-2:0')).toEqual({ f: -2, t: 0 })
    expect(parseR('Hari ini')).toBeNull()
  })

  it('rLabel: satu hari, satu bulan, lintas bulan', () => {
    expect(rLabel(0, 0, T0)).toBe('24 Nov')
    expect(rLabel(-2, 0, T0)).toBe('22–24 Nov')
    expect(rLabel(0, 7, T0)).toBe('24 Nov – 1 Des')
  })

  it('dayMatch mencocokkan label relatif ke rentang', () => {
    expect(dayMatch('Kemarin', 'r:-1:0')).toBe(true)
    expect(dayMatch('2 hari lalu', 'r:-1:0')).toBe(false)
    expect(dayMatch('Besok', 'Besok')).toBe(true)
  })

  it('whenLabel', () => {
    expect(whenLabel(0, '17:00', T0)).toBe('Hari ini 17:00')
    expect(whenLabel(1, '08:00', T0)).toBe('Besok 08:00')
    expect(whenLabel(3, '08:00', T0)).toBe('27 Nov 08:00')
  })

  it('monthCells: November 2026 mulai Minggu = 6 sel kosong', () => {
    const cells = monthCells(2026, 10)
    expect(cells.slice(0, 6).every((c) => c === null)).toBe(true)
    expect(cells.filter(Boolean)).toHaveLength(30)
  })
})

describe('logic', () => {
  it('draftOf: tidak ada draf di chat yang botnya aktif atau saat dijeda', () => {
    const s = initialState()
    const sarah = s.cv.find((c) => c.n === 'Sarah M.')!
    const lukas = s.cv.find((c) => c.n === 'Lukas B.')!
    expect(draftOf(sarah, s.agm, false)).toBeNull()
    expect(draftOf(lukas, s.agm, false)?.ag).toBe('balas')
    expect(draftOf(lukas, s.agm, true)).toBeNull()
    expect(draftOf(lukas, { ...s.agm, balas: 'mati' }, false)).toBeNull()
  })

  it('draftOf: follow-up lead hanya bila mode lead = draf', () => {
    const s = initialState()
    const priya = s.cv.find((c) => c.n === 'Priya S.')!
    expect(draftOf(priya, s.agm, false)?.ag).toBe('lead')
    expect(draftOf(priya, { ...s.agm, lead: 'otomatis' }, false)).toBeNull()
  })

  it('filterConvs', () => {
    const s = initialState()
    expect(filterConvs(s.cv, 'Semua')).toHaveLength(s.cv.length)
    expect(filterConvs(s.cv, 'Email').map((c) => c.n)).toEqual(['Daniel P.'])
    expect(filterConvs(s.cv, 'Belum dibalas').every((c) => c.un > 0)).toBe(true)
  })

  it('lencana dan akurasi', () => {
    const s = initialState()
    expect(antreanTotal(s)).toBe(9)
    expect(inboxBadge(s.cv)).toBe(12)
    expect(accuracy({ ok: 41, bad: 4 })).toBe(91)
    expect(accuracy({ ok: 0, bad: 0 })).toBe(0)
  })

  it('rData menggabungkan rentang hari', () => {
    expect(rData('Hari ini', T0).p).toHaveLength(7)
    const g = rData('r:-1:0', T0)
    expect(g.p).toHaveLength(12)
    expect(g.j).toBe(3)
    expect(g.t).toBe('Gabungan 2 hari · 23–24 Nov')
    expect(rData('r:5:6', T0).p).toHaveLength(0)
  })

  it('tugas reminder per agent: tamu, crew, vendor', () => {
    expect(AGT.reminder!.map((t) => t[0])).toEqual(['Pelunasan', 'Info trip', 'Trip selesai'])
    expect(AGT.crew!.map((t) => t[0])).toEqual(['Reminder crew'])
    expect(AGT.vendor!.map((t) => t[0])).toEqual(['Vendor transport Bali'])
    expect(AGS.crew[0]).toBe('Reminder ke crew')
    expect(AGS.vendor[0]).toBe('Reminder ke vendor')
    expect(initialState().agm.crew).toBe('otomatis')
  })

  it('initialState mengembalikan salinan baru tiap panggilan', () => {
    const a = initialState()
    a.cv[0].un = 99
    expect(initialState().cv[0].un).toBe(2)
  })
})

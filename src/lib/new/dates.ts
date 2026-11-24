// Label hari relatif dan rentang tanggal untuk pratinjau /new. Rentang disimpan sebagai
// string "r:<dari>:<sampai>" (offset hari terhadap hari ini), sama dengan artifact.

export const MONS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
export const MONL = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
export const WEEKDAYS = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min']
export const DOFF: Record<string, number> = { 'Hari ini': 0, Kemarin: -1, '2 hari lalu': -2, Besok: 1, '2 hari lagi': 2, '3 hari lagi': 3 }

export function startOfDay(d: Date = new Date()): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

export function dAt(n: number, t0: Date = startOfDay()): Date {
  const d = new Date(t0)
  d.setDate(d.getDate() + n)
  return d
}

export function dOff(d: Date, t0: Date = startOfDay()): number {
  return Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - t0.getTime()) / 864e5)
}

export function parseR(v: string | undefined | null): { f: number; t: number } | null {
  const m = /^r:(-?\d+):(-?\d+)$/.exec(v || '')
  return m ? { f: +m[1], t: +m[2] } : null
}

export function dFmt(n: number, yr = false, t0: Date = startOfDay()): string {
  const d = dAt(n, t0)
  return d.getDate() + ' ' + MONS[d.getMonth()] + (yr ? ' ' + d.getFullYear() : '')
}

export function rLabel(f: number, t: number, t0: Date = startOfDay()): string {
  const a = dAt(f, t0)
  const b = dAt(t, t0)
  const cy = t0.getFullYear()
  const yr = a.getFullYear() !== cy || b.getFullYear() !== cy
  if (f === t) return dFmt(f, yr, t0)
  if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) {
    return a.getDate() + '–' + b.getDate() + ' ' + MONS[b.getMonth()] + (yr ? ' ' + b.getFullYear() : '')
  }
  return dFmt(f, yr, t0) + ' – ' + dFmt(t, yr, t0)
}

/** Apakah label hari relatif (mis. "Kemarin") cocok dengan pilihan v (label atau rentang). */
export function dayMatch(label: string, v: string): boolean {
  const r = parseR(v)
  if (!r) return label === v
  const o = DOFF[label]
  return o !== undefined && o >= r.f && o <= r.t
}

export function hhmm(d: Date): string {
  return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2)
}

export function whenLabel(off: number, tm: string, t0: Date = startOfDay()): string {
  return (off === 0 ? 'Hari ini' : off === 1 ? 'Besok' : dFmt(off, false, t0)) + ' ' + tm
}

/** Sel-sel kalender satu bulan, Senin di depan. null = sel kosong sebelum tanggal 1. */
export function monthCells(year: number, month: number): (Date | null)[] {
  const first = new Date(year, month, 1)
  const n = new Date(year, month + 1, 0).getDate()
  const lead = (first.getDay() + 6) % 7
  const out: (Date | null)[] = Array.from({ length: lead }, () => null)
  for (let d = 1; d <= n; d++) out.push(new Date(year, month, d))
  return out
}

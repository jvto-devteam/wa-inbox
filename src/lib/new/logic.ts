// Logika murni pratinjau /new, dipisah dari komponen supaya bisa diuji.
import { dayMatch, parseR, rLabel, startOfDay } from './dates'
import { AT_KEYS, RD } from './mock-data'
import type { AgentEvent, AgentKey, AgentMode, Conv, DaySummary, State } from './types'

export interface Draft {
  t: string
  ag: AgentKey
  src: string
}

/** Draf balasan untuk chat: hanya bila bot chat itu mati, agent tidak dijeda, dan draf belum dibuang. */
export function draftOf(c: Conv, agm: Record<AgentKey, AgentMode>, pause: boolean): Draft | null {
  if (pause || c.drx || c.bot) return null
  const t = c.dr || (c.wait && c.dr2)
  if (t && agm.balas !== 'mati') return { t, ag: 'balas', src: c.drs || 'Aturan: perubahan data lewat portal' }
  if (c.drl && agm.lead === 'draf') return { t: c.drl, ag: 'lead', src: 'Follow-up lead (H+2)' }
  return null
}

export function filterConvs(cv: Conv[], ifl: string): Conv[] {
  return cv.filter((c) =>
    ifl === 'Semua' ||
    (ifl === 'Belum dibalas' && c.un > 0) ||
    (ifl === 'Bot' && c.bot) ||
    (ifl === 'Saya' && !c.bot) ||
    (ifl === 'Email' && c.ch === 'ml'))
}

export function antreanTotal(s: Pick<State, 'at'>): number {
  return AT_KEYS.reduce((n, k) => n + s.at[k].length, 0)
}

/** Lencana Inbox: chat dengan pesan belum dibaca + 9 (angka artifact untuk chat di luar contoh). */
export function inboxBadge(cv: Conv[]): number {
  return cv.reduce((n, c) => n + (c.un ? 1 : 0), 0) + 9
}

export function failedCount(ae: AgentEvent[]): number {
  return ae.filter((e) => e.s === 'gagal').length
}

export function accuracy(st: { ok: number; bad: number }): number {
  const t = st.ok + st.bad
  return t ? Math.round((st.ok / t) * 100) : 0
}

/** Ringkasan untuk satu hari atau gabungan rentang. */
export function rData(v: string, t0: Date = startOfDay()): DaySummary {
  const r = parseR(v)
  if (!r) return RD[v] || { t: 'Belum ada ringkasan', a: 0, j: 0, p: [] }
  const days = Object.keys(RD).filter((k) => dayMatch(k, v))
  let p: DaySummary['p'] = []
  let a = 0
  let j = 0
  for (const k of days) {
    p = p.concat(RD[k].p)
    a = Math.max(a, RD[k].a)
    j += RD[k].j
  }
  return {
    t: days.length ? 'Gabungan ' + days.length + ' hari · ' + rLabel(r.f, r.t, t0) : 'Tidak ada ringkasan pada ' + rLabel(r.f, r.t, t0),
    a,
    j,
    p,
  }
}

export function initials(n: string): string {
  return n.slice(0, 2).toUpperCase()
}

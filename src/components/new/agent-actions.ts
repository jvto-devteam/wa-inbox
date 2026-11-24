'use client'

import type { AgentEvent, AgentKey } from '@/lib/new/types'
import { useNew } from './store'

/** "Cek" hasil kerja agent: buka tempat hasil itu berada lalu sorot elemennya. */
export function useAgentCek() {
  const st = useNew()
  return (e: AgentEvent) => {
    const h = e.h
    st.drawer(null)
    if (h.k === 'msg') {
      if (st.openConv(e.c)) st.flash('#i-chat .m', h.m)
    } else if (h.k === 'booking') {
      if (st.openConv(e.c)) st.flash('#i-pan .box', 'Jemput')
    } else if (h.k === 'note') {
      if (st.openConv(e.c)) st.flash('#i-pan .hlbox')
    } else if (h.k === 'ring') {
      if (st.openConv(e.c)) {
        st.set((d) => { d.itab = 'Ringkasan' })
        st.flash('#i-pan .box')
      }
    } else if (h.k === 'poin') {
      st.set((d) => { d.rday = h.day; d.rkind = h.kind })
      st.go('ringkasan')
      st.flash(h.n ? '#r-pts .item' : '#r-kpi .card', h.n)
    } else if (h.k === 'out') {
      st.drawer({ kind: 'agent', idx: st.s.ae.indexOf(e) })
    } else {
      st.set((d) => { d.atab = h.tab })
      st.go('antrean')
      st.flash('#a-list .item', h.n)
    }
  }
}

/** Tandai jawaban agent salah; koreksi (bila ada) menjadi draf knowledge. */
export function markWrong(
  d: { agst: Record<AgentKey, { ok: number; bad: number }>; kn: { title: string; status: 'PUBLISHED' | 'DRAFT'; ver: string; text?: string }[] },
  ag: AgentKey,
  src: string,
  fix: string,
) {
  d.agst[ag].bad++
  if (fix) d.kn.push({ title: 'Koreksi: ' + src.replace(/^Knowledge: /, '').slice(0, 40), status: 'DRAFT', ver: 'v1', text: fix })
}

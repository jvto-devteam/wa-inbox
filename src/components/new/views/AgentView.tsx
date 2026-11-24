'use client'

import { DOFF, dFmt, dayMatch, parseR, rLabel } from '@/lib/new/dates'
import { cekLabel } from '@/lib/new/logic'
import { AGENT_KEYS, AGS, AST } from '@/lib/new/mock-data'
import { useAgentCek } from '../agent-actions'
import { DaySelect } from '../Overlays'
import { StatStrip } from '../Blocks'
import { useNew } from '../store'

type Css = React.CSSProperties & Record<`--${string}`, string>
const SMALL = { width: 'auto', padding: '5px 10px', fontSize: 13, borderRadius: 8 }

export function AgentView() {
  const st = useNew()
  const { s, set } = st
  const cek = useAgentCek()
  const base = s.ae.filter((e) => dayMatch(e.d, s.aday))
  const n = (x: string) => base.filter((e) => e.s === x).length
  const aq = s.aq.trim().toLowerCase()
  const R = base.filter((e) => (s.aag === 'Semua' || e.a === s.aag) && (s.ast === 'Semua' || e.s === s.ast) && (!aq || (e.c + ' ' + e.ti).toLowerCase().includes(aq)))
  const isRange = !!parseR(s.aday)
  // Linimasa per jam ("10.00"), terbaru di atas; rentang tanggal menambahkan harinya.
  // Urut terbaru dulu: hari (DOFF), lalu jam; "sekarang" paling atas. Grup berurutan, jadi kunci grup unik.
  const rank = (e: (typeof R)[number]) => (DOFF[e.d] ?? -99) * 10000 + (/^\d\d:\d\d$/.test(e.t) ? +e.t.replace(':', '') : 9999)
  const sorted = [...R].sort((a, b) => rank(b) - rank(a))
  const groups: [string, typeof R][] = []
  for (const e of sorted) {
    const h = /^\d\d:/.test(e.t) ? e.t.slice(0, 2) + '.00' : 'Baru saja'
    const g = (isRange ? e.d + ' · ' : '') + h
    const last = groups[groups.length - 1]
    if (last && last[0] === g) last[1].push(e)
    else groups.push([g, [e]])
  }
  const dayLabel = isRange ? rLabel(parseR(s.aday)!.f, parseR(s.aday)!.t) : s.aday
  const busiest = AGENT_KEYS.map((k) => [k, base.filter((e) => e.a === k).length] as const).sort((a, b) => b[1] - a[1]).find((x) => x[1] > 0)

  return (
    <section className="view fx" id="v-agent">
      <StatStrip
        id="g-hk"
        title={<>Riwayat Agent · <b style={{ color: 'var(--ink)' }}>{dayLabel}</b>{busiest ? ' · paling sibuk ' + AGS[busiest[0]][0] + ' (' + busiest[1] + ')' : ''}</>}
        items={[
          { label: 'Aktivitas', value: base.length, on: s.ast === 'Semua', onClick: () => set((d) => { d.ast = 'Semua' }) },
          { label: 'Berhasil', value: n('ok'), tone: 'good', on: s.ast === 'ok', onClick: () => set((d) => { d.ast = 'ok' }) },
          { label: 'Gagal', value: n('gagal'), tone: n('gagal') ? 'bad' : undefined, on: s.ast === 'gagal', onClick: () => set((d) => { d.ast = 'gagal' }) },
          { label: 'Menunggu', value: n('tunggu'), tone: n('tunggu') ? 'warn' : undefined, on: s.ast === 'tunggu', onClick: () => set((d) => { d.ast = 'tunggu' }) },
        ]}
      />
      <div className="chips" id="g-chips" role="group" aria-label="Saring agent">
        <button className={s.aag === 'Semua' ? 'on' : ''} onClick={() => set((d) => { d.aag = 'Semua' })}>Semua {base.length}</button>
        {AGENT_KEYS.map((k) => (
          <button key={k} className={s.aag === k ? 'on' : ''} onClick={() => set((d) => { d.aag = k })}>
            {AGS[k][0]} {base.filter((e) => e.a === k).length}
          </button>
        ))}
      </div>
      <div className="tbar" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8, alignItems: 'center' }}>
        <DaySelect k="a" id="g-day" value={s.aday} onChange={(v) => set((d) => { d.aday = v; d.aag = 'Semua' })} style={SMALL} />
        <input className="in" id="g-q" placeholder="Cari percakapan atau aktivitas" aria-label="Cari aktivitas"
          style={{ maxWidth: 320, padding: '5px 10px', fontSize: 13, borderRadius: 8 }}
          value={s.aq} onChange={(e) => { const v = e.target.value; set((d) => { d.aq = v }) }} />
        <select className="sel" id="g-st" style={SMALL} aria-label="Saring status" value={s.ast}
          onChange={(e) => { const v = e.target.value; set((d) => { d.ast = v }) }}>
          <option value="Semua">Semua status</option>
          <option value="ok">Berhasil</option>
          <option value="gagal">Gagal</option>
          <option value="tunggu">Menunggu</option>
        </select>
      </div>
      <div className="pg-card ag-tl" id="g-t">
        {R.length ? groups.map(([g, evs]) => (
          <div key={g} className="ag-g">
            <div className="ag-h">{g}</div>
            {evs.map((e) => {
              const idx = s.ae.indexOf(e)
              const t = AST[e.s]
              return (
                <div key={idx} className="ag-ev" data-i={idx} role="button" tabIndex={0} style={{ '--c': `var(${AGS[e.a][1]})` } as Css}
                  onClick={() => st.drawer({ kind: 'agent', idx })}
                  onKeyDown={(ev) => { if (ev.key === 'Enter') st.drawer({ kind: 'agent', idx }) }}>
                  <div className="b" style={{ minWidth: 0 }}>
                    <b>{e.ti}</b>
                    <span className="m"><span className="ag" style={{ '--c': `var(${AGS[e.a][1]})` } as Css}>{AGS[e.a][0]}</span> · {e.c} · {e.t}{isRange && DOFF[e.d] !== undefined ? ', ' + dFmt(DOFF[e.d]) : ''}</span>
                  </div>
                  <div className="r">
                    <span className={'pill ' + t[0]}>{t[1]}</span>
                    <button className="btn sm cekb" onClick={(ev) => { ev.stopPropagation(); cek(e) }}>{cekLabel(e)}</button>
                  </div>
                </div>
              )
            })}
          </div>
        )) : <div className="mut" style={{ textAlign: 'center', padding: 20 }}>Tidak ada aktivitas.</div>}
      </div>
    </section>
  )
}

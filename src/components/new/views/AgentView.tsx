'use client'

import { DOFF, dFmt, dayMatch, parseR, rLabel } from '@/lib/new/dates'
import { cekLabel } from '@/lib/new/logic'
import { AGENT_KEYS, AGS, AST } from '@/lib/new/mock-data'
import { useAgentCek } from '../agent-actions'
import { DaySelect } from '../Overlays'
import { Meter, PageHero } from '../PageHero'
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
  const kpi: [string, number, string][] = [
    ['Aktivitas', base.length, 'oleh ' + AGENT_KEYS.filter((k) => base.some((e) => e.a === k)).length + ' agent'],
    ['Berhasil', n('ok'), 'selesai tanpa campur tangan'],
    ['Gagal', n('gagal'), n('gagal') ? 'perlu dicoba lagi' : 'tidak ada'],
    ['Menunggu', n('tunggu'), n('tunggu') ? 'menunggu keputusan orang' : 'tidak ada'],
  ]
  const isRange = !!parseR(s.aday)
  const dayLabel = isRange ? rLabel(parseR(s.aday)!.f, parseR(s.aday)!.t) : s.aday
  const busiest = AGENT_KEYS.map((k) => [k, base.filter((e) => e.a === k).length] as const).sort((a, b) => b[1] - a[1]).find((x) => x[1] > 0)

  return (
    <section className="view fx" id="v-agent">
      <PageHero
        view="agent"
        kicker={'Riwayat Agent · ' + dayLabel}
        title={base.length + ' aktivitas oleh ' + AGENT_KEYS.filter((k) => base.some((e) => e.a === k)).length + ' agent'}
        sub={busiest ? 'Paling sibuk: ' + AGS[busiest[0]][0] + ' (' + busiest[1] + ' tugas).' + (n('gagal') ? ' ' + n('gagal') + ' tugas gagal perlu dicek.' : '') : 'Belum ada aktivitas pada tanggal ini.'}
        status={{ text: s.pause ? 'Agent dijeda' : 'Agent berjalan', off: s.pause, onClick: () => { set((d) => { d.btab = 'Agent' }); st.go('bot') } }}
        kpiId="g-hk"
        kpis={[
          { label: kpi[0][0], value: kpi[0][1], detail: kpi[0][2], on: s.ast === 'Semua', onClick: () => set((d) => { d.ast = 'Semua' }) },
          { label: kpi[1][0], value: kpi[1][1], detail: kpi[1][2], visual: <Meter pct={base.length ? (n('ok') / base.length) * 100 : 0} />, on: s.ast === 'ok', onClick: () => set((d) => { d.ast = 'ok' }) },
          { label: kpi[2][0], value: kpi[2][1], detail: kpi[2][2], tone: n('gagal') ? 'bad' : undefined, on: s.ast === 'gagal', onClick: () => set((d) => { d.ast = 'gagal' }) },
          { label: kpi[3][0], value: kpi[3][1], detail: kpi[3][2], tone: n('tunggu') ? 'warn' : undefined, on: s.ast === 'tunggu', onClick: () => set((d) => { d.ast = 'tunggu' }) },
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
      <div className="tw">
        <table>
          <thead><tr><th>Waktu</th><th>Agent</th><th>Aktivitas</th><th>Percakapan</th><th>Status</th><th>Cek</th></tr></thead>
          <tbody id="g-t">
            {R.length ? R.map((e) => {
              const idx = s.ae.indexOf(e)
              const t = AST[e.s]
              return (
                <tr key={idx} data-i={idx} onClick={() => st.drawer({ kind: 'agent', idx })}>
                  <td className="mut sm" style={{ whiteSpace: 'nowrap' }}>
                    {e.t}{isRange && DOFF[e.d] !== undefined && <><br /><span style={{ fontSize: 11 }}>{dFmt(DOFF[e.d])}</span></>}
                  </td>
                  <td><span className="ag" style={{ '--c': `var(${AGS[e.a][1]})` } as Css}>{AGS[e.a][0]}</span></td>
                  <td>{e.ti}</td>
                  <td>{e.c}</td>
                  <td><span className={'pill ' + t[0]}>{t[1]}</span></td>
                  <td><button className="btn sm cekb" onClick={(ev) => { ev.stopPropagation(); cek(e) }}>{cekLabel(e)}</button></td>
                </tr>
              )
            }) : <tr><td colSpan={6} className="mut" style={{ textAlign: 'center', padding: 20 }}>Tidak ada aktivitas.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  )
}

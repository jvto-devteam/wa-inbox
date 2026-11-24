'use client'

import { rData } from '@/lib/new/logic'
import { KC, POINT_KINDS } from '@/lib/new/mock-data'
import { DaySelect } from '../Overlays'
import { useItemTap, useNew } from '../store'

export function RingkasanView() {
  const st = useNew()
  const { s, set, toast } = st
  const tap = useItemTap()
  const D = rData(s.rday)
  const P = D.p
  const time = D.t + (s.rregen && s.rday === 'Hari ini' ? ' · dibuat ulang ' + s.rregen + '×' : '')
  const kc = P.filter((x) => x[0] === 'komplain').length
  const kinds = ['Semua', ...POINT_KINDS.filter((k) => P.some((x) => x[0] === k))]
  const rkind = kinds.includes(s.rkind) ? s.rkind : 'Semua'
  const setDay = (v: string) => set((d) => { d.rday = v; d.rkind = 'Semua' })
  const regen = () => {
    if (s.rday !== 'Hari ini') { toast('Ringkasan hari lalu dibuat ulang dari percakapan hari itu'); return }
    set((d) => { d.rregen++ })
    toast('Ringkasan dibuat ulang')
  }
  const kpi: [string, number, string][] = [
    ['Percakapan aktif', D.a, 'dinilai ringkasan'],
    ['Poin penting', P.length, 'dari ' + new Set(P.map((x) => x[1])).size + ' percakapan'],
    ['Komplain', kc, kc ? 'perlu perhatian' : 'tidak ada'],
    ['Janji tim terbuka', D.j, D.j ? 'masuk Antrean' : 'semua ditepati'],
  ]
  const selStyle = { width: 'auto', padding: '5px 10px', fontSize: 13, borderRadius: 8 }

  return (
    <section className="view fx" id="v-ringkasan">
      <div className="grid g4" id="r-kpi" style={{ marginBottom: 12 }}>
        {kpi.map((k) => <div key={k[0]} className="card kpi"><div className="l">{k[0]}</div><div className="v">{k[1]}</div><div className="d">{k[2]}</div></div>)}
      </div>
      <div className="tabs rt" id="r-tabs">
        <button className={s.rtab === 'poin' ? 'on' : ''} onClick={() => set((d) => { d.rtab = 'poin' })}>Poin penting<i>{P.length}</i></button>
        <button className={s.rtab === 'chat' ? 'on' : ''} onClick={() => set((d) => { d.rtab = 'chat' })}>Per percakapan<i>{s.cv.length}</i></button>
        <DaySelect k="r" id="r-day2" value={s.rday} onChange={setDay} />
      </div>
      <div className="grid g21" id="r-grid" data-rt={s.rtab}>
        <div className="card" id="r-poincard">
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 160 }}>
              <h3 id="r-h">Poin penting</h3>
              <p className="hint" id="r-time" style={{ margin: '0 0 10px' }}>{time}</p>
            </div>
            <DaySelect k="r" id="r-day" value={s.rday} onChange={setDay} style={selStyle} />
            <button className="btn pri sm" id="r-regen" style={{ height: 30 }} onClick={regen}>Buat ulang</button>
          </div>
          <div className="chips" id="r-chips">
            {kinds.map((k) => <button key={k} className={k === rkind ? 'on' : ''} onClick={() => set((d) => { d.rkind = k })}>{k}</button>)}
          </div>
          <div id="r-pts">
            {!P.length ? <div className="mut" style={{ padding: 20, textAlign: 'center' }}>Tidak ada poin penting pada tanggal ini.</div>
              : P.filter((x) => rkind === 'Semua' || x[0] === rkind).map((x, i) => (
                <div key={i} className="item" onClick={tap(x[1], [{ label: 'Buka chat', run: () => st.openConv(x[1]) }])}>
                  <div><span className={'pill ' + KC[x[0]]}>{x[0]}</span> <b style={{ marginLeft: 6 }}>{x[1]}</b><p>{x[2]}</p></div>
                  <button className="btn sm" onClick={() => st.openConv(x[1])}>Buka chat</button>
                </div>
              ))}
          </div>
        </div>
        <div className="card" id="r-chatscard">
          <h3>Per percakapan</h3>
          <p className="hint">Hanya yang belum selesai ditampilkan terbuka</p>
          <div id="r-chats">
            {s.cv.map((c) => {
              const open = c.un > 0 || c.rg[0].indexOf('⏳') === 0
              return (
                <details key={c.id} className="feat" style={{ margin: '0 0 8px' }} open={open}>
                  <summary><b>{c.n}</b><span className={'pill ' + (open ? 'warn' : 'good')} style={{ marginLeft: 'auto' }}>{open ? 'Perlu tindakan' : 'Selesai'}</span></summary>
                  <div style={{ padding: '0 14px 12px' }}>
                    {c.rg.map((x, i) => <div key={i} style={{ padding: '2px 0' }}>{x}</div>)}
                    <button className="btn sm" style={{ marginTop: 8 }} onClick={() => st.openConv(c.n)}>Buka chat</button>
                  </div>
                </details>
              )
            })}
          </div>
        </div>
      </div>
      <p className="hint rtime2">{time}</p>
      <button className="rfab" aria-label="Buat ulang ringkasan" onClick={() => st.sheet('Buat ulang ringkasan?', [{ label: 'Buat ulang', run: regen }])}>
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" />
        </svg>
      </button>
    </section>
  )
}

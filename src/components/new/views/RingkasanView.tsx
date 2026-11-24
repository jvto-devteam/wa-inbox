'use client'

import { parseR, rLabel } from '@/lib/new/dates'
import { rData } from '@/lib/new/logic'
import { KC, POINT_KINDS } from '@/lib/new/mock-data'
import type { PointKind } from '@/lib/new/types'

/** Warna jenis poin mengikuti nada pill-nya (komplain merah, bayar kuning, jemput aksen); sisanya netral, dibedakan label. */
const KIND_COLOR: Record<PointKind, string> = { komplain: 'var(--bad)', bayar: 'var(--warn)', jemput: 'var(--accent)', keputusan: 'var(--muted)', lokasi: 'var(--muted)', trip: 'var(--muted)', kebutuhan: 'var(--muted)' }
import { DaySelect } from '../Overlays'
import { SegBar, StatStrip } from '../Blocks'
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
  const dayLabel = parseR(s.rday) ? rLabel(parseR(s.rday)!.f, parseR(s.rday)!.t) : s.rday
  const selStyle = { width: 'auto', padding: '5px 10px', fontSize: 13, borderRadius: 8 }

  return (
    <section className="view fx" id="v-ringkasan">
      <StatStrip
        id="r-hk"
        title={<>Ringkasan harian · <b style={{ color: 'var(--ink)' }}>{dayLabel}</b> · {time}</>}
        items={[
          { label: kpi[0][0], value: kpi[0][1] },
          { label: kpi[1][0], value: kpi[1][1], on: s.rtab === 'poin' && rkind === 'Semua', onClick: () => set((d) => { d.rtab = 'poin'; d.rkind = 'Semua' }) },
          { label: kpi[2][0], value: kpi[2][1], tone: kc ? 'bad' : undefined, on: rkind === 'komplain', onClick: () => set((d) => { d.rtab = 'poin'; d.rkind = 'komplain' }) },
          { label: 'Janji tim terbuka', value: D.j, tone: D.j ? 'warn' : undefined, onClick: () => { set((d) => { d.atab = 'Janji tim' }); st.go('antrean') } },
        ]}
      />
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
          <div style={{ marginBottom: 10 }}>
            <SegBar
              id="r-chips"
              active={rkind}
              total={{ key: 'Semua', label: 'Semua' }}
              onPick={(k) => set((d) => { d.rkind = k })}
              items={kinds.filter((k) => k !== 'Semua').map((k) => ({ key: k, label: k, n: P.filter((x) => x[0] === k).length, color: KIND_COLOR[k as PointKind] }))}
            />
          </div>
          <div id="r-pts">
            {!P.length ? <div className="mut" style={{ padding: 20, textAlign: 'center' }}>Tidak ada poin penting pada tanggal ini.</div>
              : P.filter((x) => rkind === 'Semua' || x[0] === rkind).map((x, i) => (
                <div key={i} className="item" style={{ '--kc': KIND_COLOR[x[0]] } as React.CSSProperties} onClick={tap(x[1], [{ label: 'Buka chat', run: () => st.openConv(x[1]) }])}>
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

'use client'

// Ringkasan harian, pola sama dengan Antrean: kartu sorotan (komplain / janji terbuka), satu kartu
// kendali (hari, Poin vs Per percakapan, sebaran jenis sebagai saringan), lalu daftar sederhana.
import { parseR, rLabel } from '@/lib/new/dates'
import { rData } from '@/lib/new/logic'
import { KC, POINT_KINDS } from '@/lib/new/mock-data'
import type { PointKind } from '@/lib/new/types'
import { SegBar } from '../Blocks'
import { DaySelect } from '../Overlays'
import { useItemTap, useNew } from '../store'

/** Warna jenis poin mengikuti nada pill-nya (komplain merah, bayar kuning, jemput aksen); sisanya netral, dibedakan label. */
const KIND_COLOR: Record<PointKind, string> = { komplain: 'var(--bad)', bayar: 'var(--warn)', jemput: 'var(--accent)', keputusan: 'var(--muted)', lokasi: 'var(--muted)', trip: 'var(--muted)', kebutuhan: 'var(--muted)' }

export function RingkasanView() {
  const st = useNew()
  const { s, set, toast } = st
  const tap = useItemTap()
  const D = rData(s.rday)
  const P = D.p
  const time = D.t + (s.rregen && s.rday === 'Hari ini' ? ' · dibuat ulang ' + s.rregen + '×' : '')
  const kom = P.filter((x) => x[0] === 'komplain')
  const kinds = ['Semua', ...POINT_KINDS.filter((k) => P.some((x) => x[0] === k))]
  const rkind = kinds.includes(s.rkind) ? s.rkind : 'Semua'
  const nConv = new Set(P.map((x) => x[1])).size
  const dayLabel = parseR(s.rday) ? rLabel(parseR(s.rday)!.f, parseR(s.rday)!.t) : s.rday
  const setDay = (v: string) => set((d) => { d.rday = v; d.rkind = 'Semua' })
  const regen = () => {
    if (s.rday !== 'Hari ini') { toast('Ringkasan hari lalu dibuat ulang dari percakapan hari itu'); return }
    set((d) => { d.rregen++ })
    toast('Ringkasan dibuat ulang')
  }
  const toJanji = () => { set((d) => { d.atab = 'Janji tim' }); st.go('antrean') }
  const L = P.filter((x) => rkind === 'Semua' || x[0] === rkind)
  const openN = s.cv.filter((c) => c.un > 0 || c.rg[0].indexOf('⏳') === 0).length

  return (
    <section className="view fx" id="v-ringkasan">
      {kom.length ? (
        <div className="pg-urgent">
          <div style={{ minWidth: 0 }}>
            <div className="k">Perlu perhatian · komplain{kom.length > 1 ? ' (' + kom.length + ')' : ''}</div>
            <div className="n">{kom[0][1]}</div>
            <p>{kom[0][2]}</p>
          </div>
          <div className="acts">
            <button className="btn pri sm" onClick={() => st.openConv(kom[0][1])}>Buka chat</button>
            {kom.length > 1 && <button className="btn sm" onClick={() => set((d) => { d.rtab = 'poin'; d.rkind = 'komplain' })}>Semua komplain</button>}
          </div>
          {D.j > 0 && <div className="nx">Juga: {D.j} janji tim belum ditepati · <button type="button" onClick={toJanji}>Lihat di Antrean</button></div>}
        </div>
      ) : (
        <div className="pg-urgent" style={{ borderLeftColor: 'var(--good)' }}>
          <div>
            <div className="k" style={{ color: 'var(--good)' }}>Tidak ada komplain</div>
            <div className="n">{D.j ? D.j + ' janji tim belum ditepati' : 'Semua janji tim sudah ditepati'}</div>
          </div>
          {D.j > 0 && <div className="acts"><button className="btn sm" onClick={toJanji}>Lihat di Antrean</button></div>}
        </div>
      )}

      <div className="pg-card" id="r-sum">
        <div className="pg-card-h">
          <h3>{dayLabel}</h3>
          <span className="mut sm" style={{ marginLeft: 0 }}>{D.a} percakapan aktif · {time}</span>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
            <DaySelect k="r" id="r-dsel" value={s.rday} onChange={setDay} style={{ width: 'auto', padding: '4px 8px', fontSize: 13, borderRadius: 8 }} />
            <button className="btn sm r-regen" onClick={regen}>Buat ulang</button>
          </span>
        </div>
        <div className="seg r-view" role="group" aria-label="Tampilan ringkasan">
          <button className={s.rtab === 'poin' ? 'on' : ''} onClick={() => set((d) => { d.rtab = 'poin' })}>Poin penting · {P.length}</button>
          <button className={s.rtab === 'chat' ? 'on' : ''} onClick={() => set((d) => { d.rtab = 'chat' })}>Per percakapan · {openN} perlu tindakan</button>
        </div>
        {s.rtab === 'poin' && P.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <SegBar
              id="r-chips"
              active={rkind}
              total={{ key: 'Semua', label: 'Semua' }}
              onPick={(k) => set((d) => { d.rkind = k })}
              items={kinds.filter((k) => k !== 'Semua').map((k) => ({ key: k, label: k, n: P.filter((x) => x[0] === k).length, color: KIND_COLOR[k as PointKind] }))}
            />
          </div>
        )}
      </div>

      {s.rtab === 'poin' ? (
        <div className="card" id="r-pts">
          {!P.length ? <div className="mut" style={{ padding: 20, textAlign: 'center' }}>Tidak ada poin penting pada tanggal ini.</div>
            : L.map((x, i) => (
              <div key={i} className="item" style={{ '--ac': KIND_COLOR[x[0]] } as React.CSSProperties} onClick={tap(x[1], [{ label: 'Buka chat', run: () => st.openConv(x[1]) }])}>
                <div><b>{x[1]}</b> <span className={'pill ' + KC[x[0]]}>{x[0]}</span><p>{x[2]}</p></div>
                <button className="btn sm" onClick={() => st.openConv(x[1])}>Buka chat</button>
              </div>
            ))}
          {P.length > 0 && <p className="hint" style={{ margin: '8px 0 0' }}>{L.length} poin dari {nConv} percakapan</p>}
        </div>
      ) : (
        <div className="card" id="r-chats">
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
      )}
      <button className="rfab" aria-label="Buat ulang ringkasan" onClick={() => st.sheet('Buat ulang ringkasan?', [{ label: 'Buat ulang', run: regen }])}>
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" />
        </svg>
      </button>
    </section>
  )
}

'use client'

import { Fragment } from 'react'
import { dayMatch, whenLabel } from '@/lib/new/dates'
import { AGENT_KEYS, AGS, ALBL, AT_KEYS, FUT, SD } from '@/lib/new/mock-data'
import type { AgentEvent, AtKey, Sched, Tone } from '@/lib/new/types'
import { DaySelect } from '../Overlays'
import { SegBar } from '../Blocks'
import { useItemTap, useNew, type SheetItem } from '../store'

type Css = React.CSSProperties & Record<`--${string}`, string>
/** Warna jenis antrean: slot kategorikal tetap (sama dengan Dashboard); jadwal agent abu-abu. */
const TAB_COLOR: Record<string, string> = { Balas: 'var(--s1)', 'Tindak lanjut': 'var(--s2)', 'Janji tim': 'var(--s3)', Reminder: 'var(--s4)', [FUT]: 'var(--muted)' }

function Schedule() {
  const st = useNew()
  const { s, set, toast } = st
  const tap = useItemTap()
  const SJa = s.sj.filter((e) => s.sjday === 'Semua' || dayMatch(e.d, s.sjday))
  const L = SJa.slice().sort((x, y) => SD.indexOf(x.d) - SD.indexOf(y.d) || x.t.localeCompare(y.t))
  const ags = AGENT_KEYS.filter((k) => SJa.some((e) => e.a === k))
  const sjag = s.sjag !== 'Semua' && !(ags as string[]).includes(s.sjag) ? 'Semua' : s.sjag
  const V = L.filter((e) => sjag === 'Semua' || e.a === sjag)

  const act = (e: Sched, a: 'chat' | 'kirim' | 'tunda' | 'lewat') => {
    const i = s.sj.indexOf(e)
    if (a === 'chat') { st.openConv(e.c); return }
    if (a === 'tunda') {
      const n = SD[Math.min(SD.indexOf(e.d) + 1, SD.length - 1)]
      set((d) => { d.sj[i].d = n })
      toast('Ditunda ke ' + n.toLowerCase() + ', ' + e.t)
      return
    }
    if (a === 'lewat') { set((d) => { d.sj.splice(i, 1) }); toast('Follow-up dilewati'); return }
    set((d) => {
      d.sj.splice(i, 1)
      const cv = d.cv.find((x) => x.n === e.c)
      // crew dan vendor dikabari di luar chat tamu, jadi tidak ada pesan baru di percakapan tamu
      const internal = e.a === 'vendor' || e.a === 'crew'
      const txt = e.a === 'lead' && cv && cv.drl ? cv.drl : 'Reminder: please check your trip details here: jvto.me/b/xxxx'
      const ev: AgentEvent = {
        d: 'Hari ini', t: 'sekarang', a: e.a, c: e.c, s: 'ok', ti: 'Dikirim lebih awal: ' + e.ti,
        i: 'Dijadwalkan ' + e.d.toLowerCase() + ' ' + e.t + ', dikirim manual dari Antrean',
        o: e.a === 'vendor' ? 'Kabar terkirim ke vendor' : e.a === 'crew' ? 'Reminder terkirim ke crew' : 'Pesan berisi link portal terkirim', r: false,
        h: internal ? { k: 'out' } : { k: 'msg', m: txt },
      }
      if (!internal && cv) {
        cv.msgs.push({ k: 'b', text: txt, time: 'sekarang', meta: { ag: e.a, src: e.a === 'lead' ? 'Follow-up lead' : 'Jadwal reminder', why: e.a === 'lead' ? 'Tamu tanya harga lalu berhenti membalas' : 'Data perjalanan belum lengkap' } })
        cv.last = 'Bot: ' + txt.slice(0, 34) + '…'
        if (e.a === 'lead') { cv.drx = true; d.lead.dikirim++ }
      }
      d.ae.unshift(ev)
    })
    toast('Follow-up dikirim. Tercatat di Riwayat Agent')
  }

  let last = ''
  return (
    <>
      <div className="sj-top">
        <b>Jadwal follow-up</b>
        <DaySelect k="s" value={s.sjday} onChange={(v) => set((d) => { d.sjday = v })}
          style={{ width: 'auto', padding: '5px 10px', fontSize: 13, borderRadius: 8 }} />
      </div>
      <div className="chips">
        <button className={sjag === 'Semua' ? 'on' : ''} onClick={() => set((d) => { d.sjag = 'Semua' })}>Semua {SJa.length}</button>
        {ags.map((k) => (
          <button key={k} className={sjag === k ? 'on' : ''} onClick={() => set((d) => { d.sjag = k })}>
            {AGS[k][0]} {SJa.filter((e) => e.a === k).length}
          </button>
        ))}
      </div>
      {V.length ? V.map((e, n) => {
        const head = e.d !== last ? <div className="mut sm" style={{ fontWeight: 600, padding: '10px 0 2px' }}>{e.d}</div> : null
        last = e.d
        const md: [Tone, string] = s.pause ? ['bad', 'Dijeda'] : s.agm[e.a] === 'mati' ? ['bad', 'Agent mati'] : s.agm[e.a] === 'draf' ? ['warn', 'Draf: menunggu Anda'] : ['neu', 'Otomatis']
        const pri = s.agm[e.a] === 'draf' && !s.pause ? ' pri' : ''
        const items: SheetItem[] = [
          { label: 'Buka chat', run: () => act(e, 'chat') },
          { label: 'Kirim sekarang', run: () => act(e, 'kirim') },
          { label: 'Tunda', run: () => act(e, 'tunda') },
          { label: 'Lewati', danger: true, run: () => act(e, 'lewat') },
        ]
        return (
          <Fragment key={n + e.c + e.t}>
            {head}
            <div className="item" onClick={tap(e.c, items)}>
              <div>
                <span className="ag" style={{ '--c': `var(${AGS[e.a][1]})` } as Css}>{AGS[e.a][0]}</span>{' '}
                <b style={{ marginLeft: 6 }}>{e.c}</b> <span className="pill neu">{e.t}</span> <span className={'pill ' + md[0]}>{md[1]}</span>
                <p>{e.ti}</p>
              </div>
              <div className="acts">
                <button className="btn sm" onClick={() => act(e, 'chat')}>Buka chat</button>
                <button className={'btn sm' + pri} onClick={() => act(e, 'kirim')}>Kirim sekarang</button>
                <button className="btn sm" onClick={() => act(e, 'tunda')}>Tunda</button>
                <button className="btn sm bad" onClick={() => act(e, 'lewat')}>Lewati</button>
              </div>
            </div>
          </Fragment>
        )
      }) : (
        <div className="mut" style={{ padding: 20, textAlign: 'center' }}>
          {s.sjday === 'Semua' ? 'Tidak ada follow-up terjadwal.' : 'Tidak ada follow-up terjadwal pada tanggal ini.'}
        </div>
      )}
    </>
  )
}

export function AntreanView() {
  const st = useNew()
  const { s, set, toast } = st
  const tap = useItemTap()
  const keys: (AtKey | typeof FUT)[] = [...AT_KEYS, FUT]
  const tab = s.atab

  const remind = (k: AtKey, i: number, mode: 'ing' | 'tunda') => {
    const it = s.at[k][i]
    st.remind({
      name: it.n,
      onDone: (o, t) => {
        const w = whenLabel(o, t)
        if (mode === 'ing') {
          set((d) => { d.at[k].splice(i, 1); d.at.Reminder.push({ n: it.n, d: it.d, w }) })
          toast('Dijadwalkan ' + w.toLowerCase() + '. Ada di tab Reminder')
        } else {
          set((d) => { d.at[k][i].w = w })
          toast('Reminder ditunda ke ' + w.toLowerCase())
        }
      },
    })
  }
  const tot = AT_KEYS.reduce((n, k) => n + s.at[k].length, 0)
  // Paling mendesak = item pertama antrean Balas (lalu Follow Up, Janji); "berikutnya" = sisa Balas.
  const topK = (['Balas', 'Tindak lanjut', 'Janji tim'] as AtKey[]).find((k) => s.at[k].length)
  const top = topK ? { k: topK, it: s.at[topK][0] } : null
  const next = topK ? s.at[topK].slice(1, 4) : []
  const remove = (k: AtKey, i: number, msg: string) => { set((d) => { d.at[k].splice(i, 1) }); toast(msg) }

  return (
    <section className="view fx" id="v-antrean">
      {top ? (
        <div className="pg-urgent">
          <div style={{ minWidth: 0 }}>
            <div className="k">Paling mendesak · {top.k === 'Balas' ? 'Belum dibalas' : (ALBL[top.k] || top.k)}</div>
            <div className="n">{top.it.n} <span className="pill warn">{top.it.w}</span></div>
            <p>{top.it.d}</p>
          </div>
          <div className="acts">
            <button className="btn pri sm" onClick={() => st.openConv(top.it.n)}>Balas sekarang</button>
            <button className="btn sm" onClick={() => remind(top.k, 0, top.k === 'Reminder' ? 'tunda' : 'ing')}>Ingatkan</button>
          </div>
          {next.length > 0 && (
            <div className="nx">Berikutnya: {next.map((x, i) => (
              <span key={x.n + i}>{i ? ' · ' : ''}<button type="button" onClick={() => st.openConv(x.n)}>{x.n}</button> ({x.w.replace(/^Belum dibalas /, '').toLowerCase()})</span>
            ))}</div>
          )}
        </div>
      ) : (
        <div className="pg-urgent" style={{ borderLeftColor: 'var(--good)' }}><div><div className="k" style={{ color: 'var(--good)' }}>Beres</div><div className="n">Tidak ada chat yang menunggu balasan</div></div></div>
      )}

      <div className="pg-card">
        <div className="pg-card-h"><h3>Isi antrean</h3><span className="mut sm">{tot} hal menunggu tim · {s.sj.length} follow-up agent</span></div>
        <SegBar
          id="a-tabs"
          active={tab}
          onPick={(k) => set((d) => { d.atab = k as typeof d.atab })}
          items={keys.map((k) => ({ key: k, label: (k !== FUT && ALBL[k]) || k, n: k === FUT ? s.sj.length : s.at[k].length, color: TAB_COLOR[k] }))}
        />
      </div>

      <div className="card" id="a-list">
        {tab === FUT ? <Schedule /> : s.at[tab].length ? s.at[tab].map((x, i) => {
          const items: SheetItem[] = tab === 'Reminder'
            ? [
              { label: 'Buka chat', run: () => st.openConv(x.n) },
              { label: 'Tunda', run: () => remind(tab, i, 'tunda') },
              { label: 'Selesai', run: () => remove(tab, i, 'Reminder selesai') },
            ]
            : [
              { label: 'Buka chat', run: () => st.openConv(x.n) },
              { label: 'Ingatkan', run: () => remind(tab, i, 'ing') },
              { label: 'Lepas', danger: true, run: () => remove(tab, i, 'Dilepas dengan catatan') },
            ]
          return (
            <div key={i + x.n} className="item" style={{ '--ac': TAB_COLOR[tab] } as Css} onClick={tap(x.n, items)}>
              <div><b>{x.n}</b> <span className="pill warn">{x.w}</span><p>{x.d}</p></div>
              <div className="acts">
                {items.map((b) => <button key={b.label} className={'btn sm' + (b.danger ? ' bad' : '')} onClick={b.run}>{b.label}</button>)}
              </div>
            </div>
          )
        }) : <div className="mut" style={{ padding: 20, textAlign: 'center' }}>Antrean ini kosong. Semua tertangani.</div>}
      </div>
    </section>
  )
}

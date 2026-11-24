'use client'

// Riwayat Agent (DATA ASLI): GET /api/new/agent-activity untuk rentang hari yang dipilih. Aktivitas
// dirangkai dari log yang sudah ada (keputusan bot, pesan sistem, aksi booking, ringkasan); lihat
// src/lib/new/agent-activity.ts. Baca saja.
import { useState } from 'react'
import type { Activity, ActStatus } from '@/lib/new/agent-activity'
import { DOFF, dAt, dFmt, dOff, parseR } from '@/lib/new/dates'
import { AGENT_KEYS, AGS } from '@/lib/new/mock-data'
import { Banner, StatStrip } from '../Blocks'
import { NAV_ICON } from '../icons'
import { DaySelect } from '../Overlays'
import { useNew } from '../store'
import { WaBubble } from '../WaBubble'
import { useApi } from '../useApi'

type Css = React.CSSProperties & Record<`--${string}`, string>
const ST: Record<ActStatus, [string, string]> = { ok: ['good', 'Berhasil'], gagal: ['bad', 'Gagal'], tunggu: ['warn', 'Menunggu'], batal: ['neu', 'Dibatalkan'] }
const hm = (iso: string) => { const d = new Date(iso); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) }

/** Hari pilihan ("Hari ini", "Kemarin", atau rentang r:f:t) -> [from, to) tengah malam waktu peramban (WIB). */
export function dayRange(v: string): { from: string; to: string; multi: boolean } {
  const r = parseR(v)
  const f = r ? r.f : DOFF[v] ?? 0
  const t = r ? r.t : DOFF[v] ?? 0
  return { from: dAt(f).toISOString(), to: dAt(t + 1).toISOString(), multi: t > f }
}

function Detail({ a, onClose }: { a: Activity; onClose: () => void }) {
  const t = ST[a.status]
  return (
    <div className="drawer" role="dialog" aria-label="Detail aktivitas agent">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <b style={{ fontSize: 16, flex: 1 }}>{a.title}</b>
        <button className="btn sm" aria-label="Tutup" onClick={onClose}>✕</button>
      </div>
      <div style={{ margin: '8px 0', display: 'flex', gap: 8, alignItems: 'center' }}>
        <span className="ag" style={{ '--c': `var(${AGS[a.agent][1]})` } as Css}>{AGS[a.agent][0]}</span>
        <span className={'pill ' + t[0]}>{t[1]}</span>
      </div>
      <div className="box"><h4>Waktu dan percakapan</h4><dl className="kv"><dt>Waktu</dt><dd>{new Date(a.at).toLocaleString('id-ID', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</dd><dt>Percakapan</dt><dd>{a.contact || '—'}</dd>{a.bookingRef && <><dt>Booking</dt><dd>#{a.bookingRef}</dd></>}</dl></div>
      {(a.message || a.inbound) && (
        <div className="box" style={{ marginTop: 10 }}>
          <h4>{a.message ? 'Isi pesan terkirim (bukti)' : 'Pesan tamu'}</h4>
          {a.message && <p className="ev-to">Ke: {a.message.to}</p>}
          <div className="wa-pair">
            {a.inbound && <WaBubble dir="in" text={a.inbound} time={hm(a.at)} />}
            {a.message && <WaBubble text={a.message.text} imageUrl={a.message.imageUrl} time={hm(a.at)} />}
          </div>
        </div>
      )}
      <div className="box" style={{ marginTop: 10 }}><h4>Hasil</h4>{a.output}</div>
      {!a.message && !a.inbound && <div className="box" style={{ marginTop: 10 }}><h4>Masukan</h4>{a.input}</div>}
      <div className="acts" style={{ marginTop: 12 }}>
        {a.conversationId
          ? <a className="btn pri" href={'/inbox?conversation=' + a.conversationId}>Buka chat</a>
          : <span className="mut sm">{a.chatNote || 'Tidak ada percakapan terkait di Inbox.'}</span>}
      </div>
    </div>
  )
}

export function AgentView() {
  const { s, set } = useNew()
  const [open, setOpen] = useState<Activity | null>(null)
  const rg = dayRange(s.aday)
  const api = useApi<{ items: Activity[] }>('/api/new/agent-activity?from=' + encodeURIComponent(rg.from) + '&to=' + encodeURIComponent(rg.to))
  const base = api.data?.items ?? []
  const n = (x: ActStatus) => base.filter((e) => e.status === x).length
  const aq = s.aq.trim().toLowerCase()
  const R = base.filter((e) => (s.aag === 'Semua' || e.agent === s.aag) && (s.ast === 'Semua' || e.status === s.ast) && (!aq || ((e.contact || '') + ' ' + e.title).toLowerCase().includes(aq)))
  // Linimasa per jam, terbaru dulu (API sudah mengurutkan); rentang beberapa hari menambahkan tanggal.
  const groups: [string, Activity[]][] = []
  for (const e of R) {
    const d = new Date(e.at)
    const g = (rg.multi ? dFmt(dOff(d)) + ' · ' : '') + ('0' + d.getHours()).slice(-2) + '.00'
    const last = groups[groups.length - 1]
    if (last && last[0] === g) last[1].push(e)
    else groups.push([g, [e]])
  }
  const busiest = AGENT_KEYS.map((k) => [k, base.filter((e) => e.agent === k).length] as const).sort((a, b) => b[1] - a[1]).find((x) => x[1] > 0)

  return (
    <section className="view fx" id="v-agent">
      <Banner
        tone={api.error ? 'off' : n('gagal') ? 'warn' : 'ok'}
        icon={NAV_ICON.agent}
        title={api.loading ? 'Memuat aktivitas…' : api.error ? 'Gagal memuat riwayat agent' : base.length + ' aktivitas agent'}
        sub={api.error || (api.loading ? undefined : (n('gagal') ? n('gagal') + ' gagal perlu dicek' : 'Tidak ada yang gagal') + (busiest ? ' · paling sibuk ' + AGS[busiest[0]][0] + ' (' + busiest[1] + ')' : ''))}
        right={<DaySelect k="a" id="g-day" value={s.aday} onChange={(v) => set((d) => { d.aday = v; d.aag = 'Semua' })} />}
      />
      <StatStrip
        id="g-hk"
        items={[
          { label: 'Aktivitas', value: base.length, on: s.ast === 'Semua', onClick: () => set((d) => { d.ast = 'Semua' }) },
          { label: 'Berhasil', value: n('ok'), tone: 'good', on: s.ast === 'ok', onClick: () => set((d) => { d.ast = 'ok' }) },
          { label: 'Gagal', value: n('gagal'), tone: n('gagal') ? 'bad' : undefined, on: s.ast === 'gagal', onClick: () => set((d) => { d.ast = 'gagal' }) },
          { label: 'Menunggu', value: n('tunggu'), tone: n('tunggu') ? 'warn' : undefined, on: s.ast === 'tunggu', onClick: () => set((d) => { d.ast = 'tunggu' }) },
        ]}
      />
      <div className="tabs" id="g-chips" role="group" aria-label="Saring agent">
        <button className={s.aag === 'Semua' ? 'on' : ''} onClick={() => set((d) => { d.aag = 'Semua' })}>Semua<i>{base.length}</i></button>
        {AGENT_KEYS.map((k) => (
          <button key={k} className={s.aag === k ? 'on' : ''} onClick={() => set((d) => { d.aag = k })}>
            {AGS[k][0]}<i>{base.filter((e) => e.agent === k).length}</i>
          </button>
        ))}
      </div>
      <div className="g-bar">
        <input className="in" id="g-q" placeholder="Cari kontak atau aktivitas" aria-label="Cari aktivitas"
          value={s.aq} onChange={(e) => { const v = e.target.value; set((d) => { d.aq = v }) }} />
        <select className="sel" id="g-st" aria-label="Saring status" value={s.ast}
          onChange={(e) => { const v = e.target.value; set((d) => { d.ast = v }) }}>
          <option value="Semua">Semua status</option>
          <option value="ok">Berhasil</option>
          <option value="gagal">Gagal</option>
          <option value="tunggu">Menunggu</option>
        </select>
      </div>
      <div className="pg-card ag-tl" id="g-t">
        {api.loading ? <div className="mut" style={{ textAlign: 'center', padding: 20 }}>Memuat…</div>
          : R.length ? groups.map(([g, evs]) => (
            <div key={g} className="ag-g">
              <div className="ag-h">{g}</div>
              {evs.map((e) => {
                const t = ST[e.status]
                return (
                  <div key={e.id} className="ag-ev" data-i={e.id} role="button" tabIndex={0} style={{ '--c': `var(${AGS[e.agent][1]})` } as Css}
                    onClick={() => setOpen(e)} onKeyDown={(ev) => { if (ev.key === 'Enter') setOpen(e) }}>
                    <div className="b" style={{ minWidth: 0 }}>
                      <b>{e.title}</b>
                      <span className="ag-m"><span className="ag" style={{ '--c': `var(${AGS[e.agent][1]})` } as Css}>{AGS[e.agent][0]}</span>{e.contact ? ' · ' + e.contact : ''} · {hm(e.at)}</span>
                    </div>
                    <div className="r">
                      <span className={'pill ' + t[0]}>{t[1]}</span>
                      {e.conversationId && <a className="btn sm" href={'/inbox?conversation=' + e.conversationId} onClick={(ev) => ev.stopPropagation()}>Buka chat</a>}
                    </div>
                  </div>
                )
              })}
            </div>
          )) : <div className="mut" style={{ textAlign: 'center', padding: 20 }}>{api.error ? 'Tidak bisa memuat riwayat.' : 'Tidak ada aktivitas.'}</div>}
      </div>
      {open && (
        <div id="g-drawer" onClick={(e) => { if (e.target === e.currentTarget) setOpen(null) }}>
          <Detail a={open} onClose={() => setOpen(null)} />
        </div>
      )}
    </section>
  )
}

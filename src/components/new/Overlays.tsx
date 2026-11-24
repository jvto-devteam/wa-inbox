'use client'

import { useState } from 'react'
import { MONL, WEEKDAYS, dAt, dFmt, dOff, hhmm, monthCells, parseR, rLabel, whenLabel } from '@/lib/new/dates'
import { cekLabel, initials } from '@/lib/new/logic'
import { AGS, AST, KT, SRC } from '@/lib/new/mock-data'
import { markWrong, useAgentCek } from './agent-actions'
import { useNew, type DayKey, type RemReq, type SheetItem } from './store'

export function ActionSheet({ title, items, onClose }: { title: string; items: SheetItem[]; onClose: () => void }) {
  return (
    <div className="msheet">
      <div className="mscrim" onClick={onClose} />
      <div className="mpanel" role="dialog" aria-label={title}>
        <div className="mgrab" />
        <div className="mtitle">{title}</div>
        <div className="mgroup">
          {items.map((it, i) => (
            <button key={i} className={'mrow' + (it.danger ? ' dng' : '')} onClick={() => { onClose(); it.run() }}>
              {it.label}
              {it.checked && <span className="mck">&#10003;</span>}
            </button>
          ))}
        </div>
        <button className="mrow mcan" onClick={onClose}>Batal</button>
      </div>
    </div>
  )
}

function MonthGrid({ year, month, cls, onPick, onHover, disablePast }: {
  year: number
  month: number
  cls: (o: number) => string
  onPick: (o: number) => void
  onHover?: (o: number) => void
  disablePast?: boolean
}) {
  return (
    <div className="dm">
      <div className="dm-t">{MONL[month]} {year}</div>
      <div className="dm-g">
        {WEEKDAYS.map((w) => <div key={w} className="dm-w">{w}</div>)}
        {monthCells(year, month).map((d, i) => {
          if (!d) return <div key={'e' + i} />
          const o = dOff(d)
          const past = disablePast && o < 0
          const c = cls(o)
          return (
            <button
              key={i}
              type="button"
              className={'dd' + c}
              aria-label={d.getDate() + ' ' + MONL[month] + ' ' + year}
              aria-pressed={/ s| e| mid/.test(c)}
              disabled={past}
              style={past ? { opacity: 0.35, cursor: 'default' } : undefined}
              onClick={() => onPick(o)}
              onMouseOver={onHover ? () => onHover(o) : undefined}
            >
              {d.getDate()}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function RangePicker({ current, onApply, onClose }: { current: string; onApply: (v: string) => void; onClose: () => void }) {
  const cur = parseR(current)
  const d0 = dAt(cur ? cur.f : 0)
  const [f, setF] = useState<number | null>(cur ? cur.f : null)
  const [t, setT] = useState<number | null>(cur ? cur.t : null)
  const [hov, setHov] = useState<number | null>(null)
  const [ym, setYm] = useState({ y: d0.getFullYear(), m: d0.getMonth() })
  const shift = (n: number) => setYm(({ y, m }) => { const x = new Date(y, m + n, 1); return { y: x.getFullYear(), m: x.getMonth() } })
  const hovR = f !== null && t === null && hov !== null ? [Math.min(f, hov), Math.max(f, hov)] : null
  const lo = t !== null ? f : hovR && hovR[0]
  const hi = t !== null ? t : hovR && hovR[1]
  const cls = (o: number) => {
    let c = ''
    if (o === 0) c += ' td'
    if (f !== null && o === f) c += ' s'
    if (t !== null && o === t) c += ' e'
    else if (t === null && hovR && o === hovR[1] && o !== f) c += ' e'
    if (lo !== null && hi !== null && lo !== hi) c += ' r'
    if (lo !== null && hi !== null && o > lo && o < hi) c += ' mid'
    return c
  }
  const pick = (o: number) => {
    if (f === null || t !== null) { setF(o); setT(null) } else if (o < f) { setT(f); setF(o) } else setT(o)
    setHov(null)
  }
  const sum = f === null ? 'Pilih tanggal mulai' : t === null ? dFmt(f, true) + ' – pilih tanggal akhir' : rLabel(f, t) + ' · ' + (t - f + 1) + ' hari'
  return (
    <div className="drp">
      <div className="drp-scrim" onClick={onClose} />
      <div className="drp-panel" role="dialog" aria-modal="true" aria-label="Pilih rentang tanggal">
        <div className="drp-nav">
          <button type="button" aria-label="Bulan sebelumnya" onClick={() => shift(-1)}>‹</button>
          <b>Pilih rentang tanggal</b>
          <button type="button" aria-label="Bulan berikutnya" onClick={() => shift(1)}>›</button>
        </div>
        <div className="drp-cals">
          {[0, 1].map((i) => {
            const x = new Date(ym.y, ym.m + i, 1)
            return (
              <MonthGrid key={i} year={x.getFullYear()} month={x.getMonth()} cls={cls} onPick={pick}
                onHover={(o) => { if (f !== null && t === null && hov !== o) setHov(o) }} />
            )
          })}
        </div>
        <div className="drp-foot">
          <span className="drp-sum">{sum}</span>
          <span className="drp-act">
            <button type="button" className="btn sm" onClick={onClose}>Batal</button>
            <button type="button" className="btn pri sm" disabled={f === null}
              onClick={() => { if (f === null) return; onClose(); onApply('r:' + f + ':' + (t === null ? f : t)) }}>Terapkan</button>
          </span>
        </div>
      </div>
    </div>
  )
}

export function RemPicker({ req, onClose }: { req: RemReq; onClose: () => void }) {
  const d0 = dAt(1)
  const [st, setSt] = useState({ off: 1, tm: '08:00', y: d0.getFullYear(), m: d0.getMonth(), preset: '' })
  const setAt = (off: number, tm: string, preset: string) => { const d = dAt(off); setSt({ off, tm, y: d.getFullYear(), m: d.getMonth(), preset }) }
  const now = new Date()
  const past = st.off < 0 || (st.off === 0 && st.tm <= hhmm(now))
  const shift = (n: number) => setSt((p) => { const x = new Date(p.y, p.m + n, 1); return { ...p, y: x.getFullYear(), m: x.getMonth() } })
  const preset = (p: string) => {
    const n = new Date()
    if (p === 'jam') { const x = new Date(n.getTime() + 36e5); setAt(dOff(x), hhmm(x), p) }
    else if (p === 'sore') setAt(hhmm(n) < '17:00' ? 0 : 1, '17:00', p)
    else setAt(1, '08:00', p)
  }
  return (
    <div className="drp">
      <div className="drp-scrim" onClick={onClose} />
      <div className="drp-panel rem-panel" role="dialog" aria-modal="true" aria-label="Ingatkan kapan">
        <div className="rem-h">Ingatkan kapan?</div>
        <div className="rem-s">{req.name}</div>
        <div className="rem-p">
          {[['jam', '1 jam lagi'], ['sore', 'Sore ini 17:00'], ['besok', 'Besok 08:00']].map(([k, l]) => (
            <button key={k} type="button" className={'btn sm' + (st.preset === k ? ' on' : '')} onClick={() => preset(k)}>{l}</button>
          ))}
        </div>
        <div className="drp-nav">
          <button type="button" aria-label="Bulan sebelumnya" onClick={() => shift(-1)}>‹</button>
          <b>Pilih tanggal</b>
          <button type="button" aria-label="Bulan berikutnya" onClick={() => shift(1)}>›</button>
        </div>
        <MonthGrid year={st.y} month={st.m} disablePast
          cls={(o) => (o === 0 ? ' td' : '') + (o === st.off ? ' s' : '')}
          onPick={(o) => setSt((p) => ({ ...p, off: o, preset: '' }))} />
        <div className="rem-t">
          <label htmlFor="rem-time">Jam</label>
          <input className="in" type="time" id="rem-time" value={st.tm} onChange={(e) => setSt((p) => ({ ...p, tm: e.target.value, preset: '' }))} />
        </div>
        <div className="rem-w" hidden={!past}>Waktu itu sudah lewat. Pilih waktu yang akan datang.</div>
        <div className="drp-foot">
          <span className="drp-sum">{whenLabel(st.off, st.tm)}</span>
          <span className="drp-act">
            <button type="button" className="btn sm" onClick={onClose}>Batal</button>
            <button type="button" className="btn pri sm" disabled={past || !/^\d\d:\d\d$/.test(st.tm)}
              onClick={() => { if (past) return; onClose(); req.onDone(st.off, st.tm) }}>Jadwalkan</button>
          </span>
        </div>
      </div>
    </div>
  )
}

export function KontakDrawer({ idx, onClose }: { idx: number; onClose: () => void }) {
  const st = useNew()
  const r = KT[idx]
  if (!r) return null
  return (
    <div className="drawer" role="dialog" aria-label="Detail kontak">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div className="av">{initials(r.n)}</div>
        <div><b style={{ fontSize: 16 }}>{r.n}</b><div className="mut sm">{r.ch} · {r.lab}</div></div>
        <button className="btn sm" style={{ marginLeft: 'auto' }} aria-label="Tutup" onClick={onClose}>✕</button>
      </div>
      <div className="box" style={{ marginTop: 12 }}><h4>Booking</h4><dl className="kv"><dt>Kode</dt><dd>{r.kode}</dd><dt>Ringkas</dt><dd>{r.ringkas}</dd></dl></div>
      <div className="box" style={{ marginTop: 10 }}><h4>Label</h4><span className="pill info">{r.lab}</span></div>
      <div className="box" style={{ marginTop: 10 }}><h4>Reminder</h4><span className="mut">Belum ada</span></div>
      <div className="box" style={{ marginTop: 10 }}><h4>Catatan</h4><textarea className="ta" aria-label="Catatan" placeholder="Tulis catatan internal" /></div>
      <div className="box" style={{ marginTop: 10 }}>
        <h4>Consent</h4>
        <div className="set">
          <div><b>Boleh dihubungi lewat WhatsApp</b><span className="h">Hanya tampil di halaman Kontak</span></div>
          <label className="sw"><input type="checkbox" defaultChecked aria-label="Consent" /><i /></label>
        </div>
      </div>
      <div className="acts" style={{ marginTop: 12 }}>
        <button className="btn pri" onClick={() => { onClose(); st.openConv(r.n) }}>Buka di Inbox</button>
      </div>
    </div>
  )
}

export function AgentDrawer({ idx, onClose }: { idx: number; onClose: () => void }) {
  const st = useNew()
  const cek = useAgentCek()
  const [open, setOpen] = useState(false)
  const [fix, setFix] = useState('')
  const e = st.s.ae[idx]
  if (!e) return null
  const tone = AST[e.s]
  const src = e.src || SRC[e.a][0]
  const save = () => {
    const v = fix.trim()
    st.set((d) => { const x = d.ae[idx]; x.fb = 'salah'; x.fix = v || undefined; markWrong(d, x.a, src, v) })
    setOpen(false)
    st.toast(v ? 'Ditandai salah. Koreksi disimpan sebagai draf knowledge' : 'Ditandai salah. Dipakai untuk akurasi agent')
  }
  return (
    <div className="drawer" role="dialog" aria-label="Detail aktivitas agent">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <b style={{ fontSize: 16, flex: 1 }}>{e.ti}</b>
        <button className="btn sm" aria-label="Tutup" onClick={onClose}>✕</button>
      </div>
      <div style={{ margin: '8px 0', display: 'flex', gap: 8, alignItems: 'center' }}>
        <span className="ag" style={{ '--c': `var(${AGS[e.a][1]})` } as React.CSSProperties}>{AGS[e.a][0]}</span>
        <span className={'pill ' + tone[0]}>{tone[1]}</span>
      </div>
      <div className="box"><h4>Waktu dan percakapan</h4><dl className="kv"><dt>Waktu</dt><dd>{e.d}, {e.t}</dd><dt>Percakapan</dt><dd>{e.c}</dd></dl></div>
      <div className="box" style={{ marginTop: 10 }}><h4>Masukan</h4>{e.i}</div>
      <div className="box" style={{ marginTop: 10 }}><h4>Hasil</h4>{e.o}</div>
      <div className="box" style={{ marginTop: 10 }}><h4>Sumber dan alasan</h4><dl className="kv"><dt>Sumber</dt><dd>{src}</dd><dt>Alasan</dt><dd>{e.why || SRC[e.a][1]}</dd></dl></div>
      <div className="box" style={{ marginTop: 10 }}>
        <h4>Penilaian</h4>
        {e.fb === 'salah' ? (
          <>
            <span className="pill bad">Ditandai salah</span>
            {e.fix && <p className="mut sm" style={{ margin: '6px 0 0' }}>Koreksi: {e.fix}</p>}
          </>
        ) : open ? (
          <>
            <textarea className="ta" placeholder="Jawaban yang benar (opsional)" aria-label="Jawaban yang benar" value={fix} onChange={(x) => setFix(x.target.value)} autoFocus />
            <div className="acts" style={{ marginTop: 6 }}>
              <button className="btn sm" onClick={() => setOpen(false)}>Batal</button>
              <button className="btn pri sm" onClick={save}>Tandai salah</button>
            </div>
          </>
        ) : (
          <button className="btn sm bad" onClick={() => {
            if (e.a === 'balas' || e.a === 'lead') setOpen(true)
            else {
              st.set((d) => { d.ae[idx].fb = 'salah'; markWrong(d, e.a, src, '') })
              st.toast('Ditandai salah. Dipakai untuk akurasi agent')
            }
          }}>Tandai salah</button>
        )}
      </div>
      <div className="acts" style={{ marginTop: 12 }}>
        {e.h.k !== 'out' && <button className="btn pri" onClick={() => cek(e)}>{cekLabel(e)}</button>}
        <button className="btn" onClick={() => { onClose(); if (e.c === 'Semua percakapan') st.go('ringkasan'); else st.openConv(e.c) }}>Buka chat</button>
        {e.s === 'gagal' && (
          <button className="btn" onClick={() => {
            st.set((d) => { d.ae[idx].s = 'ok'; d.ae[idx].o = 'Berhasil dikirim ulang sekarang' })
            onClose()
            st.toast('Dicoba lagi, berhasil')
          }}>Coba lagi</button>
        )}
        {e.r && e.s === 'ok' && (
          <button className="btn bad" onClick={() => {
            st.set((d) => { d.ae[idx].s = 'batal'; d.ae[idx].o += ' · dibatalkan, tamu perlu dikabari manual' })
            onClose()
            st.toast('Perubahan dibatalkan')
          }}>Batalkan</button>
        )}
      </div>
    </div>
  )
}

/** Pilihan hari: opsi tetap + rentang terpilih + "Pilih tanggal…". */
export const DAY_OPTS: Record<DayKey, { opts: string[]; lbl?: Record<string, string> }> = {
  r: { opts: ['Hari ini', 'Kemarin'] },
  a: { opts: ['Hari ini', 'Kemarin'] },
  s: { opts: ['Semua', 'Hari ini', 'Besok'], lbl: { Semua: 'Semua tanggal' } },
}

export function DaySelect({ k, value, onChange, id, style, className = 'sel' }: {
  k: DayKey
  value: string
  onChange: (v: string) => void
  id?: string
  style?: React.CSSProperties
  className?: string
}) {
  const st = useNew()
  const D = DAY_OPTS[k]
  const r = parseR(value)
  return (
    <select className={className} id={id} style={style} aria-label="Pilih hari" value={value}
      onChange={(e) => { if (e.target.value === '__pick') st.pickRange(k); else onChange(e.target.value) }}>
      {D.opts.map((o) => <option key={o} value={o}>{(D.lbl && D.lbl[o]) || o}</option>)}
      {r ? <option value={value}>{rLabel(r.f, r.t)}</option> : D.opts.includes(value) ? null : <option value={value}>{value}</option>}
      <option value="__pick">Pilih tanggal…</option>
    </select>
  )
}


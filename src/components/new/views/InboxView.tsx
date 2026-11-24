'use client'

import { useEffect, useState } from 'react'
import { draftOf, filterConvs, initials } from '@/lib/new/logic'
import { AGS, CH, IFL } from '@/lib/new/mock-data'
import type { Conv, State } from '@/lib/new/types'
import { markWrong } from '../agent-actions'
import { useNew } from '../store'

type Css = React.CSSProperties & Record<`--${string}`, string>

function MsgPop({ c, mi, rect, onClose }: { c: Conv; mi: number; rect: DOMRect; onClose: () => void }) {
  const st = useNew()
  const [form, setForm] = useState(false)
  const [fix, setFix] = useState('')
  const m = c.msgs[mi].meta
  useEffect(() => {
    const close = (e: MouseEvent) => { const t = e.target as HTMLElement; if (!t.closest('.mpop') && !t.closest('.mchev')) onClose() }
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [onClose])
  if (!m) return null
  const top = rect.bottom + 6 + 200 > window.innerHeight ? Math.max(8, rect.top - 206) : rect.bottom + 6
  const save = () => {
    const v = fix.trim()
    st.set((d: State) => {
      const x = d.cv.find((y) => y.id === c.id)?.msgs[mi].meta
      if (!x) return
      x.fb = 'salah'; x.fix = v || undefined
      markWrong(d, x.ag, x.src, v)
    })
    st.toast(v ? 'Ditandai salah. Koreksi disimpan sebagai draf knowledge' : 'Ditandai salah. Dipakai untuk akurasi agent')
    onClose()
  }
  return (
    <div className="mpop" role="menu" style={{ right: Math.max(8, window.innerWidth - rect.right), top }} onClick={(e) => e.stopPropagation()}>
      <div className="mp-src"><div className="mp-h">Sumber</div><div>{m.src}</div><div className="mp-why">{m.why}</div></div>
      {m.fb === 'salah' ? (
        <div className="mp-done">Ditandai salah{m.fix && <div className="mp-why">Koreksi: {m.fix}</div>}</div>
      ) : form ? (
        <div className="mp-form">
          <textarea aria-label="Jawaban yang benar" placeholder="Jawaban yang benar (opsional)" autoFocus value={fix} onChange={(e) => setFix(e.target.value)} />
          <div className="mp-acts">
            <button className="btn sm" onClick={() => setForm(false)}>Batal</button>
            <button className="btn pri sm" onClick={save}>Tandai salah</button>
          </div>
        </div>
      ) : (
        <button className="mp-act" role="menuitem" onClick={() => setForm(true)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V4M5 4h11l-2 4 2 4H5" /></svg>Tandai jawaban salah
        </button>
      )}
    </div>
  )
}

export function InboxView() {
  const st = useNew()
  const { s, set, toast } = st
  const [pop, setPop] = useState<{ id: number; mi: number; rect: DOMRect } | null>(null)
  const c = s.cv.find((x) => x.id === s.icv) || s.cv[0]
  const L = filterConvs(s.cv, s.ifl)
  const dr = draftOf(c, s.agm, s.pause)
  const val = c.edit !== undefined ? c.edit : dr ? dr.t : ''
  const upd = (fn: (x: Conv, d: State) => void) => set((d) => { const x = d.cv.find((y) => y.id === c.id); if (x) fn(x, d) })
  const first = c.n.split(' ')[0]

  const send = () => {
    const v = val.trim()
    if (!v) return
    upd((x, d) => {
      const dd = draftOf(x, d.agm, d.pause)
      if (dd && v === dd.t) d.agst[dd.ag].ok++
      if (dd) x.drx = true
      x.wait = false
      x.edit = undefined
      x.msgs.push({ k: 'a', text: v, time: 'sekarang' })
      x.last = 'Admin: ' + v
      x.bot = false
    })
  }
  const tool = (t: string) => {
    let v = ''
    if (t === 'Template') v = 'Terima kasih, kami cek dulu dan segera kembali ke Anda.'
    else if (t === 'Saran AI') v = 'Hello ' + first + ', thank you for your message. We will confirm the details shortly.'
    else if (t === 'Link edit portal') {
      if (c.bk.kode === '—') { toast('Tamu ini belum punya booking, jadi belum ada link portal'); return }
      v = 'Hello ' + first + ', you can edit your pickup time and t-shirt sizes yourself through your portal link: jvto.me/b/xxxx'
    } else { toast('Pilih berkas untuk dilampirkan'); return }
    upd((x) => { x.edit = v })
  }

  return (
    <section className={'view fx' + (st.mstate === 'chat' ? ' m-chat' : '')} id="v-inbox">
      <div className="inbox">
        <div className="col">
          <div className="flt" id="i-flt">
            {IFL.map((f) => <button key={f} className={f === s.ifl ? 'on' : ''} onClick={() => set((d) => { d.ifl = f })}>{f}</button>)}
          </div>
          <div className="rows" id="i-rows">
            {L.length ? L.map((x) => (
              <button key={x.id} className={'row' + (x.id === c.id ? ' on' : '')}
                onClick={() => { set((d) => { d.icv = x.id; const y = d.cv.find((z) => z.id === x.id); if (y) y.un = 0 }); setPop(null); if (st.isM) st.setChatMode('chat') }}>
                <div className="av">{initials(x.n)}</div>
                <div>
                  <b>{x.n} <span className={'lb lb-' + x.lb.toLowerCase()}>{x.lb}</span></b>
                  <p>{draftOf(x, s.agm, s.pause) && <><span className="pill info" style={{ padding: '0 6px', fontSize: 11 }}>Draf siap</span> </>}{x.last}</p>
                </div>
                <div className="t">{x.t}{x.un > 0 && <><br /><span className="un">{x.un}</span></>}</div>
              </button>
            )) : <div className="mut" style={{ padding: 16 }}>Tidak ada chat.</div>}
          </div>
        </div>

        <div className="col" id="i-chat">
          <div className="chead">
            <button className="mback" aria-label="Kembali ke daftar chat" onClick={() => st.setChatMode('list')}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7" /></svg>
            </button>
            <div className="av">{initials(c.n)}</div>
            <div><b>{c.n}</b><div className="mut sm">{CH[c.ch][0]} · {c.bk.kode}</div></div>
            <label className="sw" style={{ marginLeft: 'auto' }} title="Bot untuk chat ini">
              <input type="checkbox" checked={c.bot} aria-label="Bot aktif untuk chat ini"
                onChange={(e) => { const on = e.target.checked; upd((x) => { x.bot = on }); toast(on ? 'Bot dinyalakan untuk chat ini' : 'Anda mengambil alih chat ini') }} />
              <i />
            </label>
            <span className="sm mut" style={{ width: 62 }}>{s.pause ? 'Agent dijeda' : c.bot ? 'Bot aktif' : 'Manual'}</span>
            <button className="minfo" aria-label="Info chat" onClick={() => st.toggleInfo()}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>
            </button>
          </div>
          <div className="msgs" onScroll={() => setPop(null)}>
            {c.msgs.map((m, mi) => m.k === 's' ? (
              <div key={mi} className="m s">{m.text}</div>
            ) : (
              <div key={mi} className={'m ' + m.k + (m.meta ? ' hasmeta' : '')}>
                {m.text}
                <small>{m.k === 'b' ? 'Bot · ' : m.k === 'a' ? 'Admin · ' : ''}{m.time}{m.meta?.fb === 'salah' ? ' · Ditandai salah' : ''}</small>
                {m.meta && (
                  <button className="mchev" aria-label="Sumber dan penilaian balasan bot" aria-haspopup="menu"
                    aria-expanded={pop?.id === c.id && pop.mi === mi}
                    onClick={(e) => {
                      e.stopPropagation()
                      const rect = e.currentTarget.getBoundingClientRect()
                      setPop((p) => (p && p.id === c.id && p.mi === mi ? null : { id: c.id, mi, rect }))
                    }}>
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="comp">
            {dr && (
              <div className="dbar">
                <span className="ag" style={{ '--c': `var(${AGS[dr.ag][1]})` } as Css}>Draf dari {AGS[dr.ag][0]}</span>
                <span className="mut sm" style={{ flex: 1 }}>Sumber: {dr.src}</span>
                <button className="btn sm" onClick={() => { upd((x) => { x.drx = true; x.edit = '' }); toast('Draf dibuang') }}>Buang draf</button>
              </div>
            )}
            <textarea aria-label="Tulis balasan" placeholder="Tulis balasan…" value={val}
              onChange={(e) => { const v = e.target.value; upd((x) => { x.edit = v }) }}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} />
            <div className="tools">
              <div className="tl2">
                {['Template', 'Saran AI', 'Link edit portal', 'Lampiran'].map((t) => <button key={t} className="btn sm" onClick={() => tool(t)}>{t}</button>)}
              </div>
              <button className="btn pri sm" id="snd" style={{ marginLeft: 'auto' }} onClick={send}>Kirim</button>
            </div>
          </div>
        </div>

        <div className="col">
          <div className="tabs" id="i-tabs" style={{ padding: '0 8px', margin: 0 }}>
            {(['Booking', 'Ringkasan', 'Kontak'] as const).map((t) => (
              <button key={t} className={t === s.itab ? 'on' : ''} onClick={() => set((d) => { d.itab = t })}
                style={{ background: 'none', border: 0, borderBottom: '2px solid ' + (t === s.itab ? 'var(--accent)' : 'transparent'), padding: 10, fontWeight: 550, color: t === s.itab ? 'var(--ink)' : 'var(--muted)' }}>
                {t}
              </button>
            ))}
          </div>
          <div className="pan" id="i-pan">
            {s.itab === 'Booking' ? (
              <>
                <div className="box">
                  <h4>Booking</h4>
                  <dl className="kv">
                    <dt>Kode</dt><dd>{c.bk.kode}</dd>
                    <dt>Paket</dt><dd>{c.bk.paket}</dd>
                    <dt>Tanggal</dt><dd>{c.bk.tgl}</dd>
                    <dt>Jemput</dt><dd>{c.bk.jemput}</dd>
                    <dt>Bayar</dt><dd><span className={'pill ' + c.bk.bayar[0]}>{c.bk.bayar[1]}</span></dd>
                    <dt>Portal</dt><dd>{c.bk.kode === '—' ? '—' : 'jvto.me/b/xxxx'}</dd>
                  </dl>
                </div>
                <div className="box">
                  <h4>Catatan dan reminder</h4>
                  {c.note && <div className="hlbox" style={{ marginBottom: 6 }}>{c.note}</div>}
                  {c.rem ? <><span className="pill info">Besok 08:00</span> </> : <span className="mut">Belum ada. </span>}
                  <button className="btn sm" onClick={() => { upd((x) => { x.rem = true }); toast('Reminder dibuat untuk besok 08:00') }}>+ Reminder</button>
                </div>
              </>
            ) : s.itab === 'Ringkasan' ? (
              <>
                <div className="box">
                  <h4>Ringkasan chat (hanya yang belum selesai)</h4>
                  {c.rg.map((x, i) => <div key={i} style={{ padding: '3px 0' }}>{x}</div>)}
                </div>
                <button className="btn sm" onClick={() => toast('Ringkasan diperbarui')}>Perbarui sekarang</button>
              </>
            ) : (
              <>
                <div className="box">
                  <h4>Kontak</h4>
                  <dl className="kv">
                    <dt>Nama</dt><dd>{c.n}</dd>
                    <dt>Kontak</dt><dd>{c.kt.tel}</dd>
                    <dt>Negara</dt><dd>{c.kt.neg}</dd>
                    <dt>Label</dt><dd>{c.kt.lab}</dd>
                    <dt>Consent</dt><dd>Di halaman Kontak</dd>
                  </dl>
                </div>
                <button className="btn sm" onClick={() => st.go('kontak')}>Buka di Kontak</button>
              </>
            )}
          </div>
        </div>
      </div>
      {pop && pop.id === c.id && <MsgPop key={pop.mi} c={c} mi={pop.mi} rect={pop.rect} onClose={() => setPop(null)} />}
    </section>
  )
}

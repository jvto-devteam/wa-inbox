'use client'

import { useState } from 'react'
import { accuracy } from '@/lib/new/logic'
import { AGD, AGENT_KEYS, AGS, AGT, LG, MODES } from '@/lib/new/mock-data'
import type { AgentKey, AgentMode, State } from '@/lib/new/types'
import { StatStrip } from '../Blocks'
import { useItemTap, useNew } from '../store'

type Css = React.CSSProperties & Record<`--${string}`, string>
const TABS: State['btab'][] = ['Perilaku', 'Agent', 'Knowledge', 'Uji', 'Log']

function Sw({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return <label className="sw"><input type="checkbox" checked={on} aria-label={label} onChange={(e) => onChange(e.target.checked)} /><i /></label>
}

function Perilaku() {
  const { s, set, toast } = useNew()
  const [f, setF] = useState(s.bs)
  const row = (k: 'auto' | 'skip' | 'hand', b: string, h: string) => (
    <div className="set"><div><b>{b}</b><span className="h">{h}</span></div><Sw on={f[k]} label={b} onChange={(v) => setF({ ...f, [k]: v })} /></div>
  )
  return (
    <div className="grid g2">
      <div className="card">
        <h3>Mode bot</h3>
        <p className="hint">Simpan = langsung berlaku</p>
        {row('auto', 'Bot menjawab semua chat', 'Matikan untuk mengambil alih semua')}
        {row('skip', 'Lewati nomor Indonesia', 'Tim membalas sendiri')}
        {row('hand', 'Serahkan bila tamu minta manusia', 'Lapisan eskalasi')}
        <div className="set">
          <div><b>Jam kerja 08:00–20:00 WIB</b><span className="h">Hanya menambah satu kalimat pada pesan serah-terima. Bot tetap menjawab 24/7.</span></div>
          <span className="pill neu">Info</span>
        </div>
      </div>
      <div className="card">
        <h3>Kalimat cadangan</h3>
        <p className="hint">Kosong = pakai bawaan kode</p>
        <label className="f">Balasan cadangan<textarea className="ta" value={f.fb} onChange={(e) => setF({ ...f, fb: e.target.value })} /></label>
        <label className="f">Balasan serah-terima<textarea className="ta" value={f.hr} onChange={(e) => setF({ ...f, hr: e.target.value })} /></label>
        <button className="btn pri" onClick={() => { set((d) => { d.bs = f }); toast('Tersimpan dan langsung berlaku') }}>Simpan</button>
      </div>
    </div>
  )
}

function Agents() {
  const st = useNew()
  const { s, set, toast } = st
  const tap = useItemTap()
  const setMode = (k: AgentKey, m: AgentMode) => {
    set((d) => { d.agm[k] = m })
    toast(AGS[k][0] + ': ' + MODES.find((x) => x[0] === m)![1] + '. Berlaku langsung.')
  }
  const lastRun = (k: AgentKey) => {
    const e = s.ae.find((x) => x.a === k && x.d === 'Hari ini')
    return e ? e.t + ' (' + e.c + ')' : 'belum ada hari ini'
  }
  return (
    <>
      <div className="card" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <h3>Jeda semua agent</h3>
          <p className="hint" style={{ margin: 0 }}>Semua agent berhenti bertindak. Chat tetap masuk dan bisa dibalas manual.</p>
        </div>
        <span className={'pill ' + (s.pause ? 'bad' : 'good')}>{s.pause ? 'Dijeda' : 'Berjalan'}</span>
        <button className={'btn ' + (s.pause ? 'pri' : 'bad')} onClick={() => { const p = !s.pause; set((d) => { d.pause = p }); toast(p ? 'Semua agent dijeda' : 'Semua agent dilanjutkan') }}>
          {s.pause ? 'Lanjutkan semua' : 'Jeda semua'}
        </button>
      </div>
      <div className="card">
        <h3>Agent</h3>
        <p className="hint">Mode menentukan seberapa jauh agent boleh bertindak. Berlaku langsung setelah dipilih.</p>
        {AGENT_KEYS.map((k) => {
          const m = s.agm[k]
          const items = MODES.map(([mk, ml]) => ({ label: ml, checked: m === mk, run: () => setMode(k, mk) }))
          const tot = s.agst[k].ok + s.agst[k].bad
          return (
            <div key={k} className="item" onClick={tap(AGS[k][0] + ' · mode', items)}>
              <div>
                <span className="ag" style={{ '--c': `var(${AGS[k][1]})` } as Css}>{AGS[k][0]}</span>{' '}
                {s.pause ? <span className="pill bad">Dijeda</span> : m === 'mati' ? <span className="pill neu">Mati</span> : null}
                <p>{AGD[k]}</p>
                {AGT[k] && (
                  <p className="agt" style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                    {AGT[k]!.map(([t, w]) => <span key={t} className="pill neu">{t} · {w}</span>)}
                  </p>
                )}
                <p>
                  Akurasi <b>{accuracy(s.agst[k])}%</b> dari {tot} penilaian · Terakhir: {lastRun(k)}
                  {k === 'lead' && ' · ' + s.lead.booking + ' dari ' + s.lead.dikirim + ' lead akhirnya booking'}
                </p>
              </div>
              <span className="mval">{MODES.find((x) => x[0] === m)![1]}</span>
              <div className="seg agseg" role="group" aria-label={'Mode ' + AGS[k][0]}>
                {MODES.map(([mk, ml]) => <button key={mk} className={m === mk ? 'on' : ''} onClick={() => setMode(k, mk)}>{ml}</button>)}
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

function Knowledge() {
  const { s, set, toast } = useNew()
  return (
    <div className="grid g2">
      <div className="card">
        <h3>Knowledge</h3>
        <p className="hint">Revisi yang diterbitkan tidak bisa diubah; setiap perubahan = versi baru</p>
        {s.kn.map((k, i) => (
          <div key={i} className="item">
            <div><b>{k.title}</b><p>Versi {k.ver}</p></div>
            {k.status === 'PUBLISHED' ? <span className="pill good">PUBLISHED</span> : (
              <div className="acts">
                <span className="pill neu">DRAFT</span>
                <button className="btn sm" onClick={() => { set((d) => { d.kn[i].status = 'PUBLISHED' }); toast('"' + k.title + '" terbit dan langsung dipakai bot') }}>Terbitkan</button>
              </div>
            )}
          </div>
        ))}
        <button className="btn sm" style={{ marginTop: 8 }} onClick={() => { set((d) => { d.kn.push({ title: 'Knowledge baru', status: 'DRAFT', ver: 'v1' }) }); toast('Draf knowledge dibuat') }}>+ Tambah</button>
      </div>
      <div className="card">
        <h3>Celah knowledge</h3>
        <p className="hint">Pertanyaan tamu yang belum ada jawabannya</p>
        {s.gap.map((g, i) => (
          <div key={g} className="item">
            <div><b>{g}</b></div>
            <button className="btn sm" onClick={() => { set((d) => { d.kn.push({ title: d.gap.splice(i, 1)[0], status: 'DRAFT', ver: 'v1' }) }); toast('Draf knowledge dibuat dari pertanyaan ini') }}>Isi jawaban</button>
          </div>
        ))}
      </div>
    </div>
  )
}

function Uji() {
  const [q, setQ] = useState('What time does Ijen open?')
  const [out, setOut] = useState('Hasil simulasi tampil di sini.')
  return (
    <div className="card" style={{ maxWidth: 640 }}>
      <h3>Simulator (dry-run)</h3>
      <p className="hint">Tidak pernah mengirim pesan dan tidak membuat pekerjaan outbound</p>
      <label className="f">Pesan tamu<input className="in" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      <button className="btn pri" onClick={() => setOut('[DRY-RUN, tidak ada pesan terkirim]\nKlasifikasi: pertanyaan jam buka\nSumber: knowledge "Jam buka Ijen" v2\nBalasan: Ijen crater is open daily from 00:00 for sunrise trekking.')}>Coba jawab</button>
      <div className="log" style={{ marginTop: 10 }}>{out}</div>
    </div>
  )
}

function Log() {
  const { s, set } = useNew()
  return (
    <>
      <div className="chips">
        {['Semua', 'Keputusan', 'Alur', 'Audit', 'Aturan'].map((t) => <button key={t} className={t === s.lf ? 'on' : ''} onClick={() => set((d) => { d.lf = t })}>{t}</button>)}
      </div>
      <div className="card">
        {LG.filter((r) => s.lf === 'Semua' || r[0] === s.lf).map((r, i) => (
          <div key={i} className="item">
            <div><span className="pill neu">{r[0]}</span> <b style={{ marginLeft: 6 }}>{r[1]}</b></div>
            <span className="mut sm">{r[2]}</span>
          </div>
        ))}
      </div>
    </>
  )
}

export function BotView() {
  const { s, set, toast } = useNew()
  const aktif = AGENT_KEYS.filter((k) => s.agm[k] !== 'mati').length
  const pub = s.kn.filter((k) => k.status === 'PUBLISHED').length
  const tot = AGENT_KEYS.reduce((n, k) => n + s.agst[k].ok + s.agst[k].bad, 0)
  const okAll = AGENT_KEYS.reduce((n, k) => n + s.agst[k].ok, 0)
  const acc = tot ? Math.round((okAll / tot) * 100) : 0
  return (
    <section className="view fx" id="v-bot">
      <div className={'bt-ban' + (s.bs.auto && !s.pause ? '' : ' off')}>
        <span className="ic" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="4" y="8" width="16" height="11" rx="3" /><path d="M12 8V4M9 13h.01M15 13h.01" /></svg></span>
        <div className="tx">
          <b>{s.pause ? 'Semua agent dijeda' : s.bs.auto ? 'Bot menjawab semua chat' : 'Bot dimatikan, tim membalas manual'}</b>
          <span>{s.bs.skip ? 'Nomor Indonesia dilewati' : 'Semua nomor dijawab'} · {s.bs.hand ? 'serahkan ke tim bila diminta' : 'tanpa eskalasi'} · bot tetap 24/7</span>
        </div>
        <Sw on={s.bs.auto} label="Bot menjawab semua chat" onChange={(v) => { set((d) => { d.bs.auto = v }); toast(v ? 'Bot menjawab semua chat. Berlaku langsung.' : 'Bot dimatikan. Tim membalas manual.') }} />
      </div>
      <StatStrip
        id="b-hk"
        items={[
          { label: 'Agent aktif', value: aktif + '/' + AGENT_KEYS.length, on: s.btab === 'Agent', onClick: () => set((d) => { d.btab = 'Agent' }) },
          { label: 'Akurasi agent', value: acc + '%', tone: acc >= 90 ? 'good' : 'warn', onClick: () => set((d) => { d.btab = 'Agent' }) },
          { label: 'Knowledge terbit', value: pub + '/' + s.kn.length, on: s.btab === 'Knowledge', onClick: () => set((d) => { d.btab = 'Knowledge' }) },
          { label: 'Celah knowledge', value: s.gap.length, tone: s.gap.length ? 'warn' : undefined, onClick: () => set((d) => { d.btab = 'Knowledge' }) },
        ]}
      />
      <div className="tabs" id="b-tabs">
        {TABS.map((k) => <button key={k} className={k === s.btab ? 'on' : ''} onClick={() => set((d) => { d.btab = k })}>{k}</button>)}
      </div>
      <div id="b-body">
        {s.btab === 'Perilaku' ? <Perilaku key={String(s.bs.auto)} /> : s.btab === 'Agent' ? <Agents /> : s.btab === 'Knowledge' ? <Knowledge /> : s.btab === 'Uji' ? <Uji /> : <Log />}
      </div>
    </section>
  )
}

'use client'

import { antreanTotal, rData } from '@/lib/new/logic'
import { AGENT_KEYS, AGS, KC } from '@/lib/new/mock-data'
import type { State, ViewKey } from '@/lib/new/types'
import { robotSvg } from '../robot'
import { useNew } from '../store'

const IC = {
  tim: (<><path d="M9 6h11M9 12h11M9 18h11" /><path d="M3.5 6l1 1 2-2M3.5 12l1 1 2-2M3.5 18l1 1 2-2" /></>),
  agent: (<><rect x="4" y="8" width="16" height="11" rx="3" /><path d="M12 8V4M9 13h.01M15 13h.01" /></>),
  acc: (<><path d="M4 5h16v11H9l-5 4z" /><path d="M8.5 10.5h7" /></>),
  poin: (<><path d="M6 3h9l4 4v14H6z" /><path d="M14 3v5h5M9 13h7M9 17h7" /></>),
}
const G: Record<string, [string, string]> = {
  balas: ['#3b6cf6', '#2347c9'], poin: ['#a855f7', '#7b2fd1'], note: ['#14b8a6', '#0b7a72'], ringkas: ['#64748b', '#334155'],
  reminder: ['#fb923c', '#ea580c'], crew: ['#38bdf8', '#0369a1'], vendor: ['#ef4444', '#b91c1c'], lead: ['#22c55e', '#15803d'],
}
type Css = React.CSSProperties & Record<`--${string}`, string>

export function HubView() {
  const st = useNew()
  const { s } = st
  const hubGo = (v: ViewKey, pre?: (d: State) => void) => { if (pre) st.set(pre); st.go(v) }

  const h = new Date().getHours()
  const sp = h < 11 ? 'pagi' : h < 15 ? 'siang' : h < 18 ? 'sore' : 'malam'
  const D = rData('Hari ini')
  const P = D.p
  const today = s.ae.filter((e) => e.d === 'Hari ini')
  const ok = today.filter((e) => e.s === 'ok').length
  const gagal = s.ae.filter((e) => e.s === 'gagal').length
  const tot = antreanTotal(s)
  const auto = today.filter((e) => e.s === 'ok' && (e.a === 'balas' || e.a === 'reminder' || e.a === 'crew' || e.a === 'vendor')).length
  const kom = P.filter((x) => x[0] === 'komplain').length
  const aktif = AGENT_KEYS.filter((k) => s.agm[k] !== 'mati').length
  const dt = new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  const K: [string, number, string, ViewKey, ((d: State) => void) | undefined, string, keyof typeof IC][] = [
    ['Isi Antrean', tot, 'Balas, Follow Up, Janji Admin, Reminder', 'antrean', (d) => { d.atab = 'Balas' }, '#3b6cf6', 'tim'],
    ['Pekerjaan agent', today.length, ok + ' berhasil hari ini', 'agent', undefined, '#22b45f', 'agent'],
    ['Pesan otomatis', auto, 'ke tamu, crew, dan vendor', 'agent', undefined, '#f97316', 'acc'],
    ['Poin penting', P.length, kom ? kom + ' komplain' : 'tanpa komplain', 'ringkasan', undefined, '#a855f7', 'poin'],
  ]
  const R: [string, number, string, ViewKey, (d: State) => void, string][] = ([
    ['Chat belum dibalas', s.at.Balas.length, 'Pelanggan menunggu jawaban tim', 'antrean', (d: State) => { d.atab = 'Balas' }, 'w'],
    ['Follow Up', s.at['Tindak lanjut'].length, 'Chat diam yang perlu disapa', 'antrean', (d: State) => { d.atab = 'Tindak lanjut' }, 'w'],
    ['Janji Admin', s.at['Janji tim'].length, 'Janji ke tamu yang belum ditepati', 'antrean', (d: State) => { d.atab = 'Janji tim' }, 'w'],
    ['Reminder', s.at.Reminder.length, 'Pengingat yang dijadwalkan tim', 'antrean', (d: State) => { d.atab = 'Reminder' }, 'i'],
    ['Tugas agent gagal', gagal, 'Perlu dicoba ulang atau diurus manual', 'agent', (d: State) => { d.ast = 'gagal' }, 'b'],
    ['Komplain hari ini', kom, 'Ada di ringkasan harian', 'ringkasan', () => {}, 'b'],
  ] as [string, number, string, ViewKey, (d: State) => void, string][]).filter((r) => r[1] > 0)
  const nx = s.sj.filter((x) => x.d === 'Hari ini').concat(s.sj.filter((x) => x.d !== 'Hari ini')).slice(0, 5)

  return (
    <section className="view fx" id="v-hub">
      <div className="hub-hero">
        <svg className="hr" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="8" width="16" height="11" rx="3" /><path d="M12 8V4M9 13h.01M15 13h.01" /></svg>
        <div className="hd">{dt}</div>
        <h2>Selamat {sp} &#128075;</h2>
        <p>Hari ini agent mengerjakan {today.length} tugas ({ok} berhasil) dan memilah {D.a} percakapan. {tot ? tot + ' hal menunggu tim.' : 'Tidak ada yang menunggu tim.'}</p>
        <span className={'pill ' + (s.pause ? 'bad' : 'good')} id="h-state">{s.pause ? 'Agent dijeda' : aktif + ' agent berjalan'}</span>
      </div>
      <div className="grid g4" id="h-kpi">
        {K.map((k) => {
          const f = () => hubGo(k[3], k[4])
          return (
            <div key={k[0]} className="card kpi hk" role="button" tabIndex={0} onClick={f}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); f() } }}>
              <div className="l">{k[0]}</div>
              <div className="v">{k[1]}</div>
              <div className="d">{k[2]}</div>
              <span className="hub-ic" style={{ '--c': k[5] } as Css}><svg viewBox="0 0 24 24" aria-hidden="true">{IC[k[6]]}</svg></span>
            </div>
          )
        })}
      </div>
      <div id="h-agents">
        <div className="hub-lab"><span>Agent bekerja hari ini</span><button type="button" onClick={() => hubGo('agent')}>Riwayat Agent</button></div>
        <div className="hub-tiles">
          {AGENT_KEYS.map((k, i) => (
            <button key={k} type="button" className="hub-tile" style={{ '--g1': G[k][0], '--g2': G[k][1] } as Css}
              onClick={() => hubGo('agent', (d) => { d.aag = k })}>
              {s.agm[k] === 'mati' ? <span className="tf">Mati</span> : s.agm[k] === 'draf' ? <span className="tf">Draf</span> : null}
              <div className="rb" style={{ '--d': i * 0.35 + 's' } as Css} dangerouslySetInnerHTML={{ __html: robotSvg(k) }} />
              <div className="tn">{AGS[k][0]}</div>
              <div className="tv">{today.filter((e) => e.a === k).length}<small>tugas</small></div>
            </button>
          ))}
        </div>
      </div>
      <div className="grid g21" id="h-grid">
        <div className="hub-col" id="h-main">
          <div className="hub-lab"><span>Perlu perhatian</span><span className="pill warn">{tot + gagal + kom} hal</span></div>
          <div className="card">
            {R.length ? R.map((r) => (
              <button key={r[0]} type="button" className="hub-r" onClick={() => hubGo(r[3], r[4])}>
                <span className={'n ' + r[5]}>{r[1]}</span>
                <span className="t"><b>{r[0]}</b><span>{r[2]}</span></span>
                <span className="c">&rsaquo;</span>
              </button>
            )) : <div className="hub-ok">Semua beres. Tidak ada yang menunggu tim.</div>}
          </div>
          <div className="hub-lab"><span>Yang terjadi di WhatsApp hari ini</span><button type="button" onClick={() => hubGo('ringkasan')}>Ringkasan lengkap</button></div>
          <div className="card">
            {P.length ? P.slice(0, 5).map((x, i) => (
              <button key={i} type="button" className="hub-li" onClick={() => st.openConv(x[1])}>
                <span className={'av ' + KC[x[0]]}>{x[1].charAt(0)}</span>
                <span className="hb">
                  <span className="tp"><b>{x[1]}</b><span className={'pill ' + KC[x[0]]}>{x[0]}</span></span>
                  <span className="tx">{x[2]}</span>
                </span>
              </button>
            )) : <div className="hub-ok">Belum ada poin penting hari ini.</div>}
          </div>
        </div>
        <div className="hub-col" id="h-side">
          <div className="hub-lab"><span>Terjadwal berikutnya</span><button type="button" onClick={() => hubGo('antrean', (d) => { d.atab = 'Follow-up agent' })}>Lihat jadwal</button></div>
          <div className="card">
            {nx.map((x, i) => (
              <div key={i} className="hub-li">
                <span className="tm">{x.t}<small>{x.d.replace('2 hari lagi', '+2 hari')}</small></span>
                <span className="hb"><span className="tp"><b>{x.c}</b></span><span className="tx">{x.ti}</span></span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

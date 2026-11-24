'use client'

// Dashboard /new (data contoh): ringkas tapi bertingkat -- hero + 4 KPI bermini-chart, bento
// (perlu perhatian, tren inquiry vs booking, alasan belum booking), strip agent yang bisa
// di-scroll, lalu poin WhatsApp hari ini dan linimasa jadwal. Palet seri: lihat new.css (.db-*).
import { useState } from 'react'
import { jakartaDay } from '@/lib/bot/eval/replay-pairs'
import { antreanTotal, rData } from '@/lib/new/logic'
import { AGENT_KEYS, AGS, ALBL, AT_KEYS, KC, SD } from '@/lib/new/mock-data'
import { periodRange, type WeekPoint } from '@/lib/new/report'
import type { AtKey, State, ViewKey } from '@/lib/new/types'
import { robotSvg } from '../robot'
import { useNew } from '../store'
import { useReport } from '../useReport'

type Css = React.CSSProperties & Record<`--${string}`, string>
/** Komposisi antrean: slot kategorikal tetap per jenis (bukan per urutan). */
const AT_COLOR: Record<AtKey, string> = { Balas: 'var(--s1)', 'Tindak lanjut': 'var(--s2)', 'Janji tim': 'var(--s3)', Reminder: 'var(--s4)' }
const MONS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
const d2 = (ymd: string) => { const [, m, d] = ymd.split('-').map(Number); return d + ' ' + MONS[m - 1] }

function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return null
  const max = Math.max(1, ...values)
  const pts = values.map((v, i) => [(i / (values.length - 1)) * 100, 26 - (v / max) * 22] as const)
  const last = pts[pts.length - 1]
  return (
    <svg className="db-spark" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={pts.map((p) => p.join(',')).join(' ')} fill="none" stroke="var(--s1)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r="2.6" fill="var(--s1)" stroke="var(--surface)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function TrendChart({ data, onPick }: { data: WeekPoint[]; onPick: () => void }) {
  const [hov, setHov] = useState<number | null>(null)
  const max = Math.max(1, ...data.map((w) => w.inquiries))
  const top = Math.ceil(max / 5) * 5 || 5
  const lastI = data.length - 1
  return (
    <>
      <div className="db-leg" style={{ marginBottom: 2 }}>
        <span><i style={{ background: 'var(--s1)' }} />Inquiry</span>
        <span><i style={{ background: 'var(--s3)' }} />Booking dari chat</span>
        <span style={{ marginLeft: 'auto' }}>skala 0–{top}</span>
      </div>
      <div className="db-cols" role="img" aria-label={'Inquiry dan booking 8 minggu: ' + data.map((w) => d2(w.from) + ' ' + w.inquiries + '/' + w.booked).join(', ')}>
        {[0.5, 1].map((f) => <div key={f} className="gl" style={{ bottom: 18 + 110 * f }} />)}
        {data.map((w, i) => {
          const show = i === lastI || i === hov
          return (
            <div key={w.from} className={'db-col' + (hov === i ? ' on' : '')} onMouseEnter={() => setHov(i)} onMouseLeave={() => setHov(null)} onClick={onPick} style={{ cursor: 'pointer' }}>
              <div className="bars">
                <span style={{ height: (w.inquiries / top) * 100 + '%', background: 'var(--s1)' }}>{show && <em>{w.inquiries}</em>}</span>
                <span style={{ height: (w.booked / top) * 100 + '%', background: 'var(--s3)' }}>{show && <em>{w.booked}</em>}</span>
              </div>
              <small>{i === lastI ? 'Minggu ini' : d2(w.from)}</small>
              {hov === i && (
                <div className="db-tip" style={{ left: '50%' }}>
                  {d2(w.from)}–{d2(w.to)} · {w.inquiries} inquiry · {w.booked} booking ({w.inquiries ? Math.round((w.booked / w.inquiries) * 100) : 0}%)
                </div>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}

export function HubView() {
  const st = useNew()
  const { s } = st
  const [kind, setKind] = useState('Semua')
  const hubGo = (v: ViewKey, pre?: (d: State) => void) => { if (pre) st.set(pre); st.go(v) }
  /** Riwayat Agent selalu dibuka pada hari ini (angka di Dashboard = hari ini), saringan lain di-reset. */
  const toAgent = (pre?: (d: State) => void) => hubGo('agent', (d) => { d.aday = 'Hari ini'; d.aag = 'Semua'; d.ast = 'Semua'; d.aq = ''; pre?.(d) })
  /** Laporan + sorot bagian yang dirujuk. */
  const toLaporan = (sel?: string) => { hubGo('laporan'); if (sel) st.flash(sel) }
  /** Ringkasan hari ini (sama dengan poin di Dashboard), opsional jenis tertentu. */
  const toRingkasan = (k = 'Semua') => hubGo('ringkasan', (d) => { d.rday = 'Hari ini'; d.rkind = k; d.rtab = 'poin' })
  const toJadwal = (name?: string) => {
    hubGo('antrean', (d) => { d.atab = 'Follow-up agent'; d.sjday = 'Semua'; d.sjag = 'Semua' })
    if (name) st.flash('#a-list .item', name)
  }

  const wk = periodRange('minggu-ini', jakartaDay(new Date()))
  const RP = useReport(wk.from, wk.to).data
  const waiting = RP ? RP.leads.filter((l) => l.lastFrom === 'tamu').length : 0
  const conv = RP && RP.inquiries ? Math.round((RP.inquiriesBooked / RP.inquiries) * 100) : 0

  const h = new Date().getHours()
  const sp = h < 11 ? 'pagi' : h < 15 ? 'siang' : h < 18 ? 'sore' : 'malam'
  const D = rData('Hari ini')
  const P = D.p
  const today = s.ae.filter((e) => e.d === 'Hari ini')
  const ok = today.filter((e) => e.s === 'ok').length
  const gagalToday = today.filter((e) => e.s === 'gagal').length
  const tot = antreanTotal(s)
  const kom = P.filter((x) => x[0] === 'komplain').length
  const aktif = AGENT_KEYS.filter((k) => s.agm[k] !== 'mati').length
  const dt = new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  const R = ([
    ['Belum dibalas', s.at.Balas.length, 'Pelanggan menunggu', 'antrean', (d: State) => { d.atab = 'Balas' }, 'w'],
    ['Follow Up', s.at['Tindak lanjut'].length, 'Chat diam', 'antrean', (d: State) => { d.atab = 'Tindak lanjut' }, 'w'],
    ['Janji Admin', s.at['Janji tim'].length, 'Belum ditepati', 'antrean', (d: State) => { d.atab = 'Janji tim' }, 'w'],
    ['Reminder', s.at.Reminder.length, 'Dijadwalkan tim', 'antrean', (d: State) => { d.atab = 'Reminder' }, 'i'],
    ['Agent gagal', gagalToday, 'Coba ulang / manual', 'agent', (d: State) => { d.aday = 'Hari ini'; d.aag = 'Semua'; d.ast = 'gagal'; d.aq = '' }, 'b'],
    ['Komplain', kom, 'Di ringkasan hari ini', 'ringkasan', (d: State) => { d.rday = 'Hari ini'; d.rkind = 'komplain'; d.rtab = 'poin' }, 'b'],
  ] as [string, number, string, ViewKey, (d: State) => void, string][]).filter((r) => r[1] > 0)

  const kinds = ['Semua', ...Array.from(new Set(P.map((x) => x[0])))]
  const PL = P.filter((x) => kind === 'Semua' || x[0] === kind)
  const sched = s.sj.slice().sort((a, b) => SD.indexOf(a.d) - SD.indexOf(b.d) || a.t.localeCompare(b.t))
  const days = Array.from(new Set(sched.map((x) => x.d)))
  const maxB = RP && RP.blockers.length ? RP.blockers[0].count : 1

  return (
    <section className="view fx" id="v-hub">
      <div className="db-hero">
        <svg className="hr" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="8" width="16" height="11" rx="3" /><path d="M12 8V4M9 13h.01M15 13h.01" /></svg>
        <div className="hd">{dt}</div>
        <h2>Selamat {sp} &#128075;</h2>
        <p>Agent mengerjakan {today.length} tugas ({ok} berhasil){gagalToday ? ', ' + gagalToday + ' gagal' : ''}. {tot ? tot + ' hal menunggu tim.' : 'Tidak ada yang menunggu tim.'}</p>
        <button type="button" className={'st' + (s.pause ? ' off' : '')} style={{ border: 0, color: '#fff' }} title="Atur agent di Bot"
          onClick={() => hubGo('bot', (d) => { d.btab = 'Agent' })}><i />{s.pause ? 'Agent dijeda' : aktif + ' agent berjalan'}</button>
      </div>

      <div className="db-kpi" id="h-kpi">
        <button type="button" className="db-k" onClick={() => hubGo('antrean', (d) => { d.atab = 'Balas' })}>
          <span className="l">Isi Antrean</span>
          <span className="r"><span className="v">{tot}</span><span className="d">menunggu tim</span></span>
          <span className="db-stack" aria-hidden="true">
            {AT_KEYS.map((k) => s.at[k].length ? <span key={k} style={{ flex: s.at[k].length, background: AT_COLOR[k] }} /> : null)}
          </span>
          <span className="db-leg">{AT_KEYS.map((k) => <span key={k}><i style={{ background: AT_COLOR[k] }} />{ALBL[k] || k} <b>{s.at[k].length}</b></span>)}</span>
        </button>
        <button type="button" className="db-k" onClick={() => toAgent()}>
          <span className="l">Pekerjaan agent</span>
          <span className="r"><span className="v">{today.length}</span><span className="d">{ok} berhasil · {gagalToday} gagal</span></span>
          <span className="db-meter" aria-hidden="true"><span style={{ width: (today.length ? (ok / today.length) * 100 : 0) + '%' }} /></span>
          <span className="db-leg"><span>Tingkat berhasil <b>{today.length ? Math.round((ok / today.length) * 100) : 0}%</b></span></span>
        </button>
        <button type="button" className="db-k" onClick={() => toLaporan('#l-kpi .card')}>
          <span className="l">Inquiry minggu ini</span>
          <span className="r"><span className="v">{RP?.inquiries ?? 0}</span><span className="d">chat WhatsApp baru</span></span>
          {RP && <Spark values={RP.trend.map((w) => w.inquiries)} />}
        </button>
        <button type="button" className="db-k" onClick={() => toLaporan('#l-bookings')}>
          <span className="l">Jadi booking</span>
          <span className="r"><span className="v">{RP?.inquiriesBooked ?? 0}</span><span className="d">konversi {conv}%</span></span>
          <span className="db-meter" aria-hidden="true"><span style={{ width: conv + '%', background: 'var(--s1)' }} /></span>
          <span className="db-leg"><span>{RP?.bookings.length ?? 0} booking minggu ini berawal dari chat</span></span>
        </button>
      </div>

      <div className="db-grid">
        <div className="db-c s4">
          <div className="db-h"><h3>Perlu perhatian</h3><span className="pill warn">{tot + gagalToday + kom}</span></div>
          {R.length ? (
            <div className="db-att">
              {R.map((r) => (
                <button key={r[0]} type="button" className="db-a" onClick={() => hubGo(r[3], r[4])}>
                  <span className={'n ' + r[5]}>{r[1]}</span>
                  <span style={{ minWidth: 0 }}><b>{r[0]}</b><span className="t">{r[2]}</span></span>
                </button>
              ))}
            </div>
          ) : <div className="hub-ok">Semua beres.</div>}
        </div>

        <div className="db-c s5">
          <div className="db-h"><h3>Inquiry vs booking · 8 minggu</h3><button type="button" className="x" onClick={() => toLaporan('#l-trend')}>Laporan</button></div>
          {RP && <TrendChart data={RP.trend} onPick={() => toLaporan('#l-trend')} />}
        </div>

        <div className="db-c s3">
          <div className="db-h"><h3>Kenapa belum booking</h3><button type="button" className="x" onClick={() => toLaporan('#l-blockers')}>Laporan</button></div>
          {RP && RP.blockers.slice(0, 5).map((b) => (
            <button key={b.alasan} type="button" className="db-hb" onClick={() => toLaporan('#l-leads')} title="Lihat lead dan rekomendasi follow-up">
              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.label}</span>
              <span className="bar"><span style={{ width: (b.count / maxB) * 100 + '%' }} /></span>
              <b>{b.count}</b>
            </button>
          ))}
          {waiting > 0 && (
            <button type="button" className="db-call" onClick={() => toLaporan('#l-leads')}>
              <b style={{ fontSize: 16 }}>{waiting}</b> lead menunggu balasan kita &rsaquo;
            </button>
          )}
        </div>

        <div className="db-c s12">
          <div className="db-h">
            <h3>Agent hari ini</h3>
            <button type="button" className="x" onClick={() => toAgent()}>Riwayat Agent</button>
          </div>
          <div className="db-agl">
            {AGENT_KEYS.map((k) => {
              const ev = today.filter((e) => e.a === k)
              const badK = ev.filter((e) => e.s === 'gagal').length
              const note = s.pause ? 'Dijeda' : s.agm[k] === 'mati' ? 'Mati' : badK ? badK + ' gagal' : s.agm[k] === 'draf' ? 'Draf saja' : ev.length ? 'Terakhir ' + ev[0].t : 'Belum ada tugas'
              return (
                <button key={k} type="button" className="db-ag" onClick={() => toAgent((d) => { d.aag = k })}>
                  <span className="rb" dangerouslySetInnerHTML={{ __html: robotSvg(k) }} />
                  <span className="tx">
                    <span className="tn">{AGS[k][0]}</span>
                    <span className={'st' + (badK || s.pause || s.agm[k] === 'mati' ? ' bad' : '')}>{note}</span>
                  </span>
                  <span className="v">{ev.length}</span>
                </button>
              )
            })}
          </div>
          <div className="db-agf mut sm">{today.length} tugas · {ok} berhasil{gagalToday ? ' · ' + gagalToday + ' gagal' : ''}</div>
        </div>

        <div className="db-c s7">
          <div className="db-h"><h3>Yang terjadi di WhatsApp hari ini</h3><button type="button" className="x" onClick={() => toRingkasan(kind)}>Ringkasan</button></div>
          <div className="db-chips">
            {kinds.map((k) => (
              <button key={k} type="button" className={k === kind ? 'on' : ''} onClick={() => setKind(k)}>
                {k} {k === 'Semua' ? P.length : P.filter((x) => x[0] === k).length}
              </button>
            ))}
          </div>
          <div className="db-scroll">
            {PL.length ? PL.map((x, i) => (
              <button key={i} type="button" className="db-li" onClick={() => st.openConv(x[1])}>
                <span className={'av ' + KC[x[0]]}>{x[1].charAt(0)}</span>
                <span className="hb">
                  <span className="tp"><b>{x[1]}</b><span className={'pill ' + KC[x[0]]}>{x[0]}</span></span>
                  <span className="tx">{x[2]}</span>
                </span>
              </button>
            )) : <div className="hub-ok">Belum ada poin penting.</div>}
          </div>
        </div>

        <div className="db-c s5">
          <div className="db-h"><h3>Terjadwal berikutnya</h3><span className="pill neu">{sched.length}</span><button type="button" className="x" onClick={() => toJadwal()}>Jadwal</button></div>
          <div className="db-scroll db-tl">
            {days.map((dd) => (
              <div key={dd}>
                <div className="db-day">{dd}</div>
                {sched.filter((x) => x.d === dd).map((x, i) => (
                  <button key={i} type="button" className="db-ev" style={{ '--c': `var(${AGS[x.a][1]})` } as Css} onClick={() => toJadwal(x.c)}>
                    <span className="t">{x.t}</span>
                    <span style={{ minWidth: 0 }}><b>{x.c}</b> <span className="mut sm" style={{ display: 'inline' }}>· {AGS[x.a][0]}</span><span className="mut sm">{x.ti}</span></span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

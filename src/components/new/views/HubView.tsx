'use client'

// Dashboard /new, DATA ASLI. Ringkas tapi bertingkat -- hero + 4 KPI bermini-chart, bento (perlu perhatian, tren
// inquiry vs booking, alasan belum booking), strip agent, lalu poin WhatsApp terbaru dan linimasa jadwal. Sumbernya
// route yang sama dengan halaman /new tujuannya, supaya angka di sini = angka di halaman yang dibuka:
//   antrean   GET /api/summary-items + /api/new/reminders, diolah buildQueue (= Antrean)
//   agent     GET /api/new/agent-activity hari ini WIB (= Riwayat Agent, hari ini)
//   poin      GET /api/daily-summary terbaru, diolah summaryDay (= Ringkasan; saringan AR-01..03 ikut)
//   jadwal    GET /api/new/agent-schedule (= Antrean → Jadwal agent)
//   laporan   GET /api/new/report minggu ini (= Laporan)
// Palet seri: lihat new.css (.db-*).
import { useState } from 'react'
import type { DailySummaryResponse } from '@/app/api/daily-summary/route'
import type { AgentScheduleResponse } from '@/app/api/new/agent-schedule/route'
import type { NewReminder } from '@/app/api/new/reminders/route'
import type { SummaryItemsResponse } from '@/app/api/summary-items/route'
import { jakartaDay } from '@/lib/bot/eval/replay-pairs'
import type { Activity } from '@/lib/new/agent-activity'
import { buildQueue } from '@/lib/new/antrean'
import { MONS } from '@/lib/new/dates'
import { AGENT_KEYS, AGS, ALBL, AT_KEYS, FUT, KC } from '@/lib/new/mock-data'
import { addDays, periodRange } from '@/lib/new/report'
import { dayHead, KIND_LABEL, SCHEDULE_AGENT, wibTime } from '@/lib/new/schedule'
import { chatHref, summaryDay } from '@/lib/new/summary'
import type { AtKey, State, ViewKey } from '@/lib/new/types'
import { robotSvg } from '../robot'
import { TrendChart } from '../Blocks'
import { Spark } from '../PageHero'
import { useNew } from '../store'
import { useApi } from '../useApi'
import { useReport } from '../useReport'

type Css = React.CSSProperties & Record<`--${string}`, string>
/** Komposisi antrean: slot kategorikal tetap per jenis (bukan per urutan). */
const AT_COLOR: Record<AtKey, string> = { Balas: 'var(--s1)', 'Tindak lanjut': 'var(--s2)', 'Janji tim': 'var(--s3)', Reminder: 'var(--s4)' }
/** Jadwal yang ditampilkan di linimasa: yang belum lewat, paling banyak sekian. */
const MAX_SCHED = 30

function fmtDay(ymd: string): string {
  const [, m, d] = ymd.split('-').map(Number)
  return m && d ? d + ' ' + MONS[m - 1] : ymd
}

export function HubView() {
  const st = useNew()
  const [kind, setKind] = useState('Semua')
  const hubGo = (v: ViewKey, pre?: (d: State) => void) => { if (pre) st.set(pre); st.go(v) }
  /** Riwayat Agent selalu dibuka pada hari ini (angka di Dashboard = hari ini), saringan lain di-reset. */
  const toAgent = (pre?: (d: State) => void) => hubGo('agent', (d) => { d.aday = 'Hari ini'; d.aag = 'Semua'; d.ast = 'Semua'; d.aq = ''; pre?.(d) })
  /** Laporan + sorot bagian yang dirujuk. */
  const toLaporan = (sel?: string) => { hubGo('laporan'); if (sel) st.flash(sel) }
  /** Ringkasan terbaru (sama dengan poin di Dashboard), opsional jenis tertentu. */
  const toRingkasan = (k = 'Semua') => hubGo('ringkasan', (d) => { d.rday = 'Hari ini'; d.rkind = k; d.rtab = 'poin' })
  const toJadwal = (name?: string) => {
    hubGo('antrean', (d) => { d.atab = FUT })
    if (name) st.flash('#a-list .item', name)
  }

  const today = jakartaDay(new Date())
  // Rentang hari ini WIB yang stabil (bukan "sampai sekarang"), supaya alamat permintaan tidak berubah tiap render.
  const dayFrom = new Date(today + 'T00:00:00+07:00').toISOString()
  const dayTo = new Date(addDays(today, 1) + 'T00:00:00+07:00').toISOString()
  const itemsApi = useApi<SummaryItemsResponse>('/api/summary-items')
  const remApi = useApi<{ reminders: NewReminder[] }>('/api/new/reminders')
  const actApi = useApi<{ items: Activity[] }>('/api/new/agent-activity?from=' + encodeURIComponent(dayFrom) + '&to=' + encodeURIComponent(dayTo))
  const sumApi = useApi<DailySummaryResponse>('/api/daily-summary')
  const schedApi = useApi<AgentScheduleResponse>('/api/new/agent-schedule')
  const wk = periodRange('minggu-ini', today)
  const RP = useReport(wk.from, wk.to).data

  const Q = buildQueue(itemsApi.data, remApi.data?.reminders, new Date())
  const qReady = !!itemsApi.data && !!remApi.data
  const tot = AT_KEYS.reduce((n, k) => n + Q[k].length, 0)
  const acts = actApi.data?.items ?? []
  const ok = acts.filter((e) => e.status === 'ok').length
  const gagal = acts.filter((e) => e.status === 'gagal').length
  const aktif = AGENT_KEYS.filter((k) => acts.some((e) => e.agent === k)).length
  const D = sumApi.data ? summaryDay(sumApi.data) : null
  const P = D?.points ?? []
  const kom = P.filter((x) => x.kind === 'komplain').length
  const waiting = RP ? RP.leads.filter((l) => l.waitingUs && !l.tripPassed).length : 0
  const conv = RP && RP.inquiries ? Math.round((RP.inquiriesBooked / RP.inquiries) * 100) : 0

  const h = new Date().getHours()
  const sp = h < 11 ? 'pagi' : h < 15 ? 'siang' : h < 18 ? 'sore' : 'malam'
  const dt = new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  const R = ([
    ['Belum dibalas', Q.Balas.length, 'Pelanggan menunggu', 'antrean', (d: State) => { d.atab = 'Balas' }, 'w'],
    ['Follow Up', Q['Tindak lanjut'].length, 'Chat diam', 'antrean', (d: State) => { d.atab = 'Tindak lanjut' }, 'w'],
    ['Janji Admin', Q['Janji tim'].length, 'Belum ditepati', 'antrean', (d: State) => { d.atab = 'Janji tim' }, 'w'],
    ['Reminder', Q.Reminder.length, 'Dijadwalkan tim', 'antrean', (d: State) => { d.atab = 'Reminder' }, 'i'],
    ['Agent gagal', gagal, 'Hari ini, cek & tangani manual', 'agent', (d: State) => { d.aday = 'Hari ini'; d.aag = 'Semua'; d.ast = 'gagal'; d.aq = '' }, 'b'],
    ['Komplain', kom, D ? 'Di ringkasan ' + fmtDay(D.date) : 'Di ringkasan', 'ringkasan', (d: State) => { d.rday = 'Hari ini'; d.rkind = 'komplain'; d.rtab = 'poin' }, 'b'],
  ] as [string, number, string, ViewKey, (d: State) => void, string][]).filter((r) => r[1] > 0)

  const kindOf = (k: string | null) => k ?? 'lainnya'
  const kinds = ['Semua', ...Array.from(new Set(P.map((x) => kindOf(x.kind))))]
  const PL = P.filter((x) => kind === 'Semua' || kindOf(x.kind) === kind)
  const nowIso = new Date().toISOString()
  const sched = (schedApi.data?.items ?? []).filter((x) => x.status === 'scheduled' && x.sendAt >= nowIso).slice(0, MAX_SCHED)
  const days = Array.from(new Set(sched.map((x) => dayHead(x.sendAt, today))))
  const maxB = RP && RP.blockers.length ? RP.blockers[0].count : 1
  const loading = (v: number, ready: boolean) => (ready ? v : '…')

  return (
    <section className="view fx" id="v-hub">
      <div className="db-hero">
        <svg className="hr" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="8" width="16" height="11" rx="3" /><path d="M12 8V4M9 13h.01M15 13h.01" /></svg>
        <div className="hd">{dt}</div>
        <h2>Selamat {sp} &#128075;</h2>
        <p>
          {actApi.data ? <>Agent mengerjakan {acts.length} tugas hari ini ({ok} berhasil){gagal ? ', ' + gagal + ' gagal' : ''}. </> : null}
          {qReady ? (tot ? tot + ' hal menunggu tim.' : 'Tidak ada yang menunggu tim.') : null}
        </p>
        <button type="button" className="st" style={{ border: 0, color: '#fff' }} title="Lihat Riwayat Agent hari ini" onClick={() => toAgent()}>
          <i />{actApi.data ? aktif + ' agent bekerja hari ini' : 'Memuat agent…'}
        </button>
      </div>

      <div className="db-kpi" id="h-kpi">
        <button type="button" className="db-k" onClick={() => hubGo('antrean', (d) => { d.atab = 'Balas' })}>
          <span className="l">Isi Antrean</span>
          <span className="r"><span className="v">{loading(tot, qReady)}</span><span className="d">menunggu tim</span></span>
          <span className="db-stack" aria-hidden="true">
            {AT_KEYS.map((k) => Q[k].length ? <span key={k} style={{ flex: Q[k].length, background: AT_COLOR[k] }} /> : null)}
          </span>
          <span className="db-leg">{AT_KEYS.map((k) => <span key={k}><i style={{ background: AT_COLOR[k] }} />{ALBL[k] || k} <b>{Q[k].length}</b></span>)}</span>
        </button>
        <button type="button" className="db-k" onClick={() => toAgent()}>
          <span className="l">Pekerjaan agent hari ini</span>
          <span className="r"><span className="v">{loading(acts.length, !!actApi.data)}</span><span className="d">{ok} berhasil · {gagal} gagal</span></span>
          <span className="db-meter" aria-hidden="true"><span style={{ width: (acts.length ? (ok / acts.length) * 100 : 0) + '%' }} /></span>
          <span className="db-leg"><span>Tingkat berhasil <b>{acts.length ? Math.round((ok / acts.length) * 100) : 0}%</b></span></span>
        </button>
        <button type="button" className="db-k" onClick={() => toLaporan('#l-hk .db-k')}>
          <span className="l">Inquiry minggu ini</span>
          <span className="r"><span className="v">{loading(RP?.inquiries ?? 0, !!RP)}</span><span className="d">chat WhatsApp nomor luar negeri</span></span>
          {RP && <Spark values={RP.trend.map((w) => w.inquiries)} />}
        </button>
        <button type="button" className="db-k" onClick={() => toLaporan('#l-bookings')}>
          <span className="l">Jadi booking</span>
          <span className="r"><span className="v">{loading(RP?.inquiriesBooked ?? 0, !!RP)}</span><span className="d">konversi {conv}%</span></span>
          <span className="db-meter" aria-hidden="true"><span style={{ width: conv + '%', background: 'var(--s1)' }} /></span>
          <span className="db-leg"><span>{RP?.bookings.length ?? 0} booking minggu ini berawal dari chat</span></span>
        </button>
      </div>

      <div className="db-grid">
        <div className="db-c s4">
          <div className="db-h"><h3>Perlu perhatian</h3><span className="pill warn">{R.reduce((n, r) => n + r[1], 0)}</span></div>
          {R.length ? (
            <div className="db-att">
              {R.map((r) => (
                <button key={r[0]} type="button" className="db-a" onClick={() => hubGo(r[3], r[4])}>
                  <span className={'n ' + r[5]}>{r[1]}</span>
                  <span style={{ minWidth: 0 }}><b>{r[0]}</b><span className="t">{r[2]}</span></span>
                </button>
              ))}
            </div>
          ) : <div className="hub-ok">{qReady ? 'Semua beres.' : 'Memuat…'}</div>}
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
              const ev = acts.filter((e) => e.agent === k)
              const badK = ev.filter((e) => e.status === 'gagal').length
              const last = ev.reduce<string | null>((m, e) => (!m || e.at > m ? e.at : m), null)
              const note = !actApi.data ? 'Memuat…' : badK ? badK + ' gagal' : last ? 'Terakhir ' + wibTime(last) : 'Belum ada tugas'
              return (
                <button key={k} type="button" className="db-ag" onClick={() => toAgent((d) => { d.aag = k })}>
                  <span className="rb" dangerouslySetInnerHTML={{ __html: robotSvg(k) }} />
                  <span className="tx">
                    <span className="tn">{AGS[k][0]}</span>
                    <span className={'st' + (badK ? ' bad' : '')}>{note}</span>
                  </span>
                  <span className="v">{ev.length}</span>
                </button>
              )
            })}
          </div>
          <div className="db-agf mut sm">{acts.length} tugas · {ok} berhasil{gagal ? ' · ' + gagal + ' gagal' : ''}</div>
        </div>

        <div className="db-c s7">
          <div className="db-h">
            <h3>Yang terjadi di WhatsApp{D ? ' · ' + fmtDay(D.date) : ''}</h3>
            <button type="button" className="x" onClick={() => toRingkasan(kind === 'lainnya' ? 'Semua' : kind)}>Ringkasan</button>
          </div>
          <div className="db-chips">
            {kinds.map((k) => (
              <button key={k} type="button" className={k === kind ? 'on' : ''} onClick={() => setKind(k)}>
                {k} {k === 'Semua' ? P.length : P.filter((x) => kindOf(x.kind) === k).length}
              </button>
            ))}
          </div>
          <div className="db-scroll">
            {PL.length ? PL.map((x, i) => (
              <a key={i} className="db-li" href={chatHref(x.conversationId, x.messageId)}>
                <span className={'av ' + (x.kind ? KC[x.kind] : 'neu')}>{x.name.charAt(0)}</span>
                <span className="hb">
                  <span className="tp"><b>{x.name}</b><span className={'pill ' + (x.kind ? KC[x.kind] : 'neu')}>{kindOf(x.kind)}</span></span>
                  <span className="tx">{x.text}</span>
                </span>
              </a>
            )) : <div className="hub-ok">{sumApi.data ? 'Belum ada poin penting.' : 'Memuat…'}</div>}
          </div>
        </div>

        <div className="db-c s5">
          <div className="db-h"><h3>Terjadwal berikutnya</h3><span className="pill neu">{sched.length}</span><button type="button" className="x" onClick={() => toJadwal()}>Jadwal</button></div>
          <div className="db-scroll db-tl">
            {sched.length ? days.map((dd) => (
              <div key={dd}>
                <div className="db-day">{dd}</div>
                {sched.filter((x) => dayHead(x.sendAt, today) === dd).map((x) => {
                  const ag = SCHEDULE_AGENT[x.kind] ?? 'reminder'
                  const who = x.guestName || x.bookingCode || 'Tanpa nama'
                  return (
                    <button key={x.key} type="button" className="db-ev" style={{ '--c': `var(${AGS[ag][1]})` } as Css} onClick={() => toJadwal(who)}>
                      <span className="t">{wibTime(x.sendAt)}</span>
                      <span style={{ minWidth: 0 }}><b>{who}</b> <span className="mut sm" style={{ display: 'inline' }}>· {AGS[ag][0]}</span><span className="mut sm">{KIND_LABEL[x.kind] ?? x.kind}{x.bookingCode ? ' · ' + x.bookingCode : ''}</span></span>
                    </button>
                  )
                })}
              </div>
            )) : <div className="hub-ok">{schedApi.data ? 'Tidak ada jadwal mendatang.' : 'Memuat…'}</div>}
          </div>
        </div>
      </div>
    </section>
  )
}

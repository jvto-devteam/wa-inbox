'use client'

// Menu Laporan: inquiry WhatsApp → booking, DATA ASLI (GET /api/new/report);
// definisi angka di src/lib/new/report.ts. Tidak ada bagian yang berhenti di bacaan: angka menyorot
// rinciannya, minggu di tren membuka periode minggu itu, alasan menyaring lead, lead punya Buka chat +
// Ingatkan (reminder kontak, catatan = follow-up), baris booking membuka chatnya.
import { Fragment, useState } from 'react'
import { jakartaDay } from '@/lib/bot/eval/replay-pairs'
import type { LeadBlocker } from '@/lib/daily-summary/payload-schema'
import { MONS, whenLabel } from '@/lib/new/dates'
import { addDays, periodRange, type PeriodKey, type ReportLead } from '@/lib/new/report'
import { TrendChart } from '../Blocks'
import { Meter, PageHero, Spark } from '../PageHero'
import { useItemTap, useNew } from '../store'
import { apiSend } from '../useApi'
import { useReport } from '../useReport'

const PERIODS: [PeriodKey, string][] = [['minggu-ini', 'Minggu ini'], ['minggu-lalu', 'Minggu lalu'], ['bulan-ini', 'Bulan ini'], ['bulan-lalu', 'Bulan lalu']]

/** Badge channel: JVTO biru dan Klook oranye memakai label yang sama dengan daftar chat Inbox; lainnya netral. */
function channelCls(ch: string): string {
  const k = ch.toLowerCase()
  return k === 'jvto' || k === 'klook' ? 'lb lb-' + k : 'pill neu'
}

function fmt(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  if (!y || !m || !d) return ymd
  return d + ' ' + MONS[m - 1]
}

/** Periode: pilihan tetap, atau "w:<Senin>" = satu minggu yang diklik di grafik tren. */
type Period = PeriodKey | `w:${string}`

function rangeOf(p: Period, today: string): { from: string; to: string } {
  if (!p.startsWith('w:')) return periodRange(p as PeriodKey, today)
  const mon = p.slice(2)
  const sun = addDays(mon, 6)
  return { from: mon, to: sun < today ? sun : today }
}

const chatHref = (id: string) => '/new/inbox?conversation=' + encodeURIComponent(id)

export function LaporanView() {
  const st = useNew()
  const tap = useItemTap()
  const [period, setPeriodRaw] = useState<Period>('minggu-ini')
  const [alasanF, setAlasanF] = useState<LeadBlocker | null>(null)
  const setPeriod = (p: Period) => { setPeriodRaw(p); setAlasanF(null) }
  const today = jakartaDay(new Date())
  const { from, to } = rangeOf(period, today)
  const { loading, data: R, error } = useReport(from, to)
  const conv = R && R.inquiries ? Math.round((R.inquiriesBooked / R.inquiries) * 100) : 0
  // Urutan dari server: menunggu balasan kita, masih bisa dikejar, lalu tanggal trip sudah lewat (AL-03, AL-05).
  const leads = R ? R.leads.filter((l) => !alasanF || l.alasan === alasanF) : []
  const groupOf = (l: ReportLead) => (l.tripPassed ? 'lewat' : l.waitingUs ? 'balas' : 'tunggu')
  const GROUP_LABEL = { balas: 'Menunggu balasan kita', tunggu: 'Menunggu tamu / belum ada kabar', lewat: 'Tanggal trip sudah lewat' } as const
  const waitingUs = R ? R.leads.filter((l) => groupOf(l) === 'balas').length : 0
  const passed = R ? R.leads.filter((l) => l.tripPassed).length : 0
  const pickAlasan = (a: LeadBlocker) => { setAlasanF((cur) => (cur === a ? null : a)); st.flash('#l-leads') }
  const go = (href: string) => window.location.assign(href)
  /** Reminder kontak berisi follow-up; tidak mengirim apa pun ke tamu. */
  const ingatkan = (l: ReportLead) => {
    const contactId = l.contactId
    if (!contactId) return
    st.remind({
      name: l.name,
      onDone: (off, tm) => {
        const dueAt = new Date(addDays(today, off) + 'T' + tm + ':00+07:00').toISOString()
        apiSend('/api/contacts/' + contactId + '/reminders', 'POST', { dueAt, note: ('Follow-up: ' + l.rekomendasi).slice(0, 500) })
          .then(() => st.toast('Reminder ' + l.name + ' dijadwalkan ' + whenLabel(off, tm).toLowerCase()))
          .catch((e: unknown) => st.toast(e instanceof Error ? e.message : 'Gagal membuat reminder'))
      },
    })
  }

  return (
    <section className="view fx" id="v-laporan">
      <PageHero
        view="laporan"
        kicker={'Laporan WhatsApp → booking · ' + fmt(from) + ' – ' + fmt(to) + ' ' + to.slice(0, 4)}
        title={R ? R.inquiries + ' inquiry, ' + R.inquiriesBooked + ' jadi booking (' + conv + '%)' : 'Memuat laporan…'}
        sub={R && R.blockers.length ? 'Alasan belum booking terbanyak: ' + R.blockers[0].label.toLowerCase() + ' (' + R.blockers[0].count + ' lead).' : undefined}
        right={
          <select aria-label="Pilih periode" value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
            {PERIODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            {period.startsWith('w:') && <option value={period}>Minggu {fmt(from)}</option>}
          </select>
        }
        kpiId="l-hk"
        kpis={[
          { label: 'Inquiry baru', value: R ? R.inquiries : '…', detail: 'chat WhatsApp nomor luar negeri', visual: R ? <Spark values={R.trend.map((w) => w.inquiries)} /> : undefined, onClick: () => st.flash('#l-trend') },
          { label: 'Jadi booking', value: R ? R.inquiriesBooked : '…', detail: 'konversi ' + conv + '%', visual: <Meter pct={conv} color="var(--s1)" />, onClick: () => st.flash('#l-bookings') },
          { label: 'Booking dari WA', value: R ? R.bookings.length : '…', detail: 'tanggal booking di periode', onClick: () => st.flash('#l-bookings') },
          { label: 'Belum booking', value: R ? R.leads.length : '…', tone: R && R.leads.length ? 'warn' : undefined, detail: R ? waitingUs + ' menunggu balasan kita' + (passed ? ' · ' + passed + ' trip sudah lewat' : '') : '', onClick: () => st.flash('#l-leads') },
        ]}
      />

      {error && <div className="card" style={{ color: 'var(--bad)', marginBottom: 12 }}>{error}</div>}

      <div className="grid g21">
        <div className="card" id="l-bookings">
          <h3>Customer dari WhatsApp yang booking</h3>
          <p className="hint">Awalnya chat WhatsApp, lalu booking. Nama membuka chat aslinya di Inbox.</p>
          {loading ? <div className="mut" style={{ padding: 16 }}>Memuat…</div> : R && R.bookings.length ? (
            <>
            <div className="l-mlist">
              {R.bookings.map((b) => (
                <div key={b.conversationId} className="item" style={{ cursor: 'pointer' }} onClick={tap(b.name, [{ label: 'Buka chat', run: () => go(chatHref(b.conversationId)) }])}>
                  <div style={{ minWidth: 0 }}>
                    <a href={'/new/inbox?conversation=' + b.conversationId} style={{ color: 'var(--accent)', fontWeight: 600, background: 'none', border: 0, padding: 0, fontSize: 15 }}>{b.name}</a>{' '}
                    <span className="mut sm">{b.phoneTail}</span>
                    <p>Chat {fmt(b.firstChatDay)} → booking {fmt(b.bookingDay)} · {b.daysToBook === 0 ? 'hari sama' : b.daysToBook + ' hari'}</p>
                    <p>{b.bookingNumber} · {b.pkg}{b.startYmd === '—' ? '' : ' · trip ' + fmt(b.startYmd)}</p>
                  </div>
                  <span className={channelCls(b.orderChannel)}>{b.orderChannel}</span>
                </div>
              ))}
            </div>
            <div className="tw">
              <table>
                <thead><tr><th>Nama</th><th>Chat pertama</th><th>Booking</th><th>Jeda</th><th>Kode</th><th>Paket</th><th>Trip</th><th>Channel</th></tr></thead>
                <tbody>
                  {R.bookings.map((b) => (
                    <tr key={b.conversationId} style={{ cursor: 'pointer' }} title="Buka chat" onClick={(e) => { if (!(e.target as HTMLElement).closest('a')) go(chatHref(b.conversationId)) }}>
                      <td><a href={'/new/inbox?conversation=' + b.conversationId} style={{ color: 'var(--accent)', fontWeight: 600, background: 'none', border: 0, padding: 0 }}>{b.name}</a><div className="mut sm">{b.phoneTail}</div></td>
                      <td className="sm">{fmt(b.firstChatDay)}</td>
                      <td className="sm">{fmt(b.bookingDay)}</td>
                      <td className="sm">{b.daysToBook === 0 ? 'hari sama' : b.daysToBook + ' hari'}</td>
                      <td className="sm">{b.bookingNumber}</td>
                      <td className="sm">{b.pkg}</td>
                      <td className="sm">{b.startYmd === '—' ? '—' : fmt(b.startYmd)}</td>
                      <td><span className={channelCls(b.orderChannel)}>{b.orderChannel}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </>
          ) : <div className="mut" style={{ padding: 16, textAlign: 'center' }}>Belum ada booking dari chat WhatsApp di periode ini.</div>}
        </div>

        <div className="card" id="l-trend">
          <h3>Tren 8 minggu</h3>
          <p className="hint">Per minggu Senin–Minggu: inquiry baru dan booking yang awalnya dari chat. Klik satu minggu untuk membuka laporannya.</p>
          {R && <TrendChart data={R.trend} onPick={(w) => { setPeriod(`w:${w.from}`); st.flash('#l-hk .db-k') }} />}
        </div>
      </div>

      <div className="grid g21" style={{ marginTop: 12 }}>
        <div className="card" id="l-leads">
          <h3>Belum booking: alasan & follow-up</h3>
          <p className="hint">Inquiry periode ini yang belum booking. Alasan dan rekomendasi dari ringkasan chat AI; yang belum dinilai AI disimpulkan dari pesan terakhir. Yang tanggal trip-nya sudah lewat tidak perlu di-follow-up lagi, tapi tetap dihitung di alasan.</p>
          {alasanF && R && (
            <div className="l-filter">
              Alasan: <b>{R.blockers.find((b) => b.alasan === alasanF)?.label ?? alasanF}</b>
              <button type="button" className="btn sm" onClick={() => setAlasanF(null)}>Tampilkan semua</button>
            </div>
          )}
          {loading ? <div className="mut" style={{ padding: 16 }}>Memuat…</div> : R && leads.length ? leads.map((l, i) => (
            <Fragment key={l.conversationId}>
            {(i === 0 || groupOf(leads[i - 1]) !== groupOf(l)) && (
              <div className="pg-sec">{GROUP_LABEL[groupOf(l)]} <span className={'pill ' + (groupOf(l) === 'balas' ? 'bad' : 'neu')}>{leads.filter((x) => groupOf(x) === groupOf(l)).length}</span></div>
            )}
            {/* Urutan baca: siapa → alasan (pill) → konteks singkat → follow-up (kotak saran). Status menunggu
                sudah dinyatakan judul kelompok, jadi di kartu tinggal lamanya. */}
            <div className="item l-lead" style={{ gridTemplateColumns: 'minmax(0,1fr)' }}
              onClick={tap(l.name, [{ label: 'Buka chat', run: () => go(chatHref(l.conversationId)) }, ...(l.contactId && !l.tripPassed ? [{ label: 'Ingatkan follow-up', run: () => ingatkan(l) }] : [])])}>
              <div style={{ minWidth: 0 }}>
                <div className="l-lh">
                  <a href={'/new/inbox?conversation=' + l.conversationId}>{l.name}</a>
                  <span className={'pill ' + (l.alasan === 'belum_dijawab' || l.alasan === 'menunggu_tim' ? 'bad' : l.alasan === 'harga' ? 'warn' : 'neu')}>{l.alasanText}</span>
                  {l.lostByUs && <span className="pill bad" title="Tanggal trip lewat sementara giliran ada di tim">Lepas karena belum kita jawab</span>}
                </div>
                <div className="l-lm">
                  {l.phoneTail} · chat {fmt(l.firstChatDay)}{l.lastFrom && l.silentDays ? ' · menunggu ' + l.silentDays + ' hari' : ''}
                  {' · '}{l.sumber === 'ai' ? 'Dinilai AI' + (l.reviewDay ? ' ' + fmt(l.reviewDay) : '') : 'Belum dinilai AI'}
                </div>
                <p className="l-lt">{l.teks}</p>
                {l.rekomendasi && !l.tripPassed && <div className="saran"><span className="saran-k">Follow-up</span><span className="saran-t">{l.rekomendasi}</span></div>}
                <div className="acts l-acts">
                  <a className={'btn sm' + (l.tripPassed ? '' : ' pri')} href={chatHref(l.conversationId)}>{l.waitingUs && !l.tripPassed ? 'Balas di chat' : 'Buka chat'}</a>
                  {l.contactId && !l.tripPassed && <button type="button" className="btn sm" onClick={() => ingatkan(l)}>Ingatkan follow-up</button>}
                </div>
              </div>
            </div>
            </Fragment>
          )) : <div className="mut" style={{ padding: 16, textAlign: 'center' }}>Semua inquiry periode ini sudah booking, atau belum ada inquiry.</div>}
        </div>

        <div className="card" id="l-blockers">
          <h3>Alasan belum booking</h3>
          <p className="hint">Jumlah lead per alasan di periode ini. Klik alasan untuk melihat lead-nya.</p>
          {loading ? <div className="mut" style={{ padding: 16 }}>Memuat…</div> : R && R.blockers.length ? R.blockers.map((b) => (
            <div key={b.alasan} className={'item l-blk' + (alasanF === b.alasan ? ' on' : '')} role="button" tabIndex={0} aria-pressed={alasanF === b.alasan}
              style={{ gridTemplateColumns: 'minmax(0,1fr) auto', cursor: 'pointer' }}
              onClick={() => pickAlasan(b.alasan)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickAlasan(b.alasan) } }}>
              <div>
                <b style={{ fontWeight: 550 }}>{b.label}</b>
                <div aria-hidden="true" style={{ marginTop: 4, height: 8, borderRadius: 4, background: 'var(--neutral-bg)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: (b.count / R.leads.length) * 100 + '%', background: 'var(--warn)' }} />
                </div>
              </div>
              <b style={{ fontVariantNumeric: 'tabular-nums' }}>{b.count}</b>
            </div>
          )) : <div className="mut" style={{ padding: 16, textAlign: 'center' }}>Tidak ada lead yang tertunda.</div>}
        </div>
      </div>

    </section>
  )
}

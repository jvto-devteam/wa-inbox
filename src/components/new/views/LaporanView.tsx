'use client'

// Menu Laporan: inquiry WhatsApp → booking, DATA ASLI (GET /api/new/report);
// definisi angka di src/lib/new/report.ts.
import { Fragment, useState } from 'react'
import { jakartaDay } from '@/lib/bot/eval/replay-pairs'
import { MONS } from '@/lib/new/dates'
import { periodRange, type PeriodKey } from '@/lib/new/report'
import { TrendChart } from '../Blocks'
import { Meter, PageHero, Spark } from '../PageHero'
import { useNew } from '../store'
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

export function LaporanView() {
  const st = useNew()
  const [period, setPeriod] = useState<PeriodKey>('minggu-ini')
  const today = jakartaDay(new Date())
  const { from, to } = periodRange(period, today)
  const { loading, data: R, error } = useReport(from, to)
  const conv = R && R.inquiries ? Math.round((R.inquiriesBooked / R.inquiries) * 100) : 0
  // Lead yang menunggu balasan kita lebih dulu (itu yang bisa langsung dikerjakan tim).
  const leads = R ? [...R.leads].sort((a, b) => Number(b.lastFrom === 'tamu') - Number(a.lastFrom === 'tamu')) : []

  return (
    <section className="view fx" id="v-laporan">
      <PageHero
        view="laporan"
        kicker={'Laporan WhatsApp → booking · ' + fmt(from) + ' – ' + fmt(to) + ' ' + to.slice(0, 4)}
        title={R ? R.inquiries + ' inquiry, ' + R.inquiriesBooked + ' jadi booking (' + conv + '%)' : 'Memuat laporan…'}
        sub={R && R.blockers.length ? 'Alasan belum booking terbanyak: ' + R.blockers[0].label.toLowerCase() + ' (' + R.blockers[0].count + ' lead).' : undefined}
        right={
          <select aria-label="Pilih periode" value={period} onChange={(e) => setPeriod(e.target.value as PeriodKey)}>
            {PERIODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        }
        kpiId="l-hk"
        kpis={[
          { label: 'Inquiry baru', value: R ? R.inquiries : '…', detail: 'chat WhatsApp nomor luar negeri', visual: R ? <Spark values={R.trend.map((w) => w.inquiries)} /> : undefined, onClick: () => st.flash('#l-trend') },
          { label: 'Jadi booking', value: R ? R.inquiriesBooked : '…', detail: 'konversi ' + conv + '%', visual: <Meter pct={conv} color="var(--s1)" /> },
          { label: 'Booking dari WA', value: R ? R.bookings.length : '…', detail: 'tanggal booking di periode', onClick: () => st.flash('#l-bookings') },
          { label: 'Belum booking', value: R ? R.leads.length : '…', tone: R && R.leads.length ? 'warn' : undefined, detail: R ? R.leads.filter((l) => l.lastFrom === 'tamu').length + ' menunggu balasan kita' : '', onClick: () => st.flash('#l-leads') },
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
                <div key={b.conversationId} className="item">
                  <div style={{ minWidth: 0 }}>
                    <a href={'/inbox?conversation=' + b.conversationId} style={{ color: 'var(--accent)', fontWeight: 600, background: 'none', border: 0, padding: 0, fontSize: 15 }}>{b.name}</a>{' '}
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
                    <tr key={b.conversationId}>
                      <td><a href={'/inbox?conversation=' + b.conversationId} style={{ color: 'var(--accent)', fontWeight: 600, background: 'none', border: 0, padding: 0 }}>{b.name}</a><div className="mut sm">{b.phoneTail}</div></td>
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
          <p className="hint">Per minggu Senin–Minggu: inquiry baru dan booking yang awalnya dari chat.</p>
          {R && <TrendChart data={R.trend} />}
        </div>
      </div>

      <div className="grid g21" style={{ marginTop: 12 }}>
        <div className="card" id="l-leads">
          <h3>Belum booking: alasan & follow-up</h3>
          <p className="hint">Inquiry periode ini yang belum booking. Alasan dan rekomendasi dari ringkasan chat AI; yang belum dinilai AI disimpulkan dari pesan terakhir.</p>
          {loading ? <div className="mut" style={{ padding: 16 }}>Memuat…</div> : R && R.leads.length ? leads.map((l, i) => (
            <Fragment key={l.conversationId}>
            {(i === 0 || (leads[i - 1].lastFrom === 'tamu') !== (l.lastFrom === 'tamu')) && (
              <div className="pg-sec">{l.lastFrom === 'tamu' ? 'Menunggu balasan kita' : 'Menunggu tamu / belum ada kabar'} <span className={'pill ' + (l.lastFrom === 'tamu' ? 'bad' : 'neu')}>{leads.filter((x) => (x.lastFrom === 'tamu') === (l.lastFrom === 'tamu')).length}</span></div>
            )}
            {/* Urutan baca: siapa → alasan (pill) → konteks singkat → follow-up (kotak saran). Status menunggu
                sudah dinyatakan judul kelompok, jadi di kartu tinggal lamanya. */}
            <div className="item l-lead" style={{ gridTemplateColumns: 'minmax(0,1fr)' }}>
              <div style={{ minWidth: 0 }}>
                <div className="l-lh">
                  <a href={'/inbox?conversation=' + l.conversationId}>{l.name}</a>
                  <span className={'pill ' + (l.alasan === 'belum_dijawab' || l.alasan === 'menunggu_tim' ? 'bad' : l.alasan === 'harga' ? 'warn' : 'neu')}>{l.alasanText}</span>
                </div>
                <div className="l-lm">
                  {l.phoneTail} · chat {fmt(l.firstChatDay)}{l.lastFrom && l.silentDays ? ' · menunggu ' + l.silentDays + ' hari' : ''}
                  {' · '}{l.sumber === 'ai' ? 'Dinilai AI' + (l.reviewDay ? ' ' + fmt(l.reviewDay) : '') : 'Belum dinilai AI'}
                </div>
                <p className="l-lt">{l.teks}</p>
                {l.rekomendasi && <div className="saran"><span className="saran-k">Follow-up</span><span className="saran-t">{l.rekomendasi}</span></div>}
              </div>
            </div>
            </Fragment>
          )) : <div className="mut" style={{ padding: 16, textAlign: 'center' }}>Semua inquiry periode ini sudah booking, atau belum ada inquiry.</div>}
        </div>

        <div className="card" id="l-blockers">
          <h3>Alasan belum booking</h3>
          <p className="hint">Jumlah lead per alasan di periode ini.</p>
          {loading ? <div className="mut" style={{ padding: 16 }}>Memuat…</div> : R && R.blockers.length ? R.blockers.map((b) => (
            <div key={b.alasan} className="item" style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}>
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

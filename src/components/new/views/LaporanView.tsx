'use client'

// Menu Laporan: inquiry WhatsApp → booking, dari DATA CONTOH (src/lib/new/report-mock.ts);
// definisi angka di src/lib/new/report.ts.
import { useState } from 'react'
import { jakartaDay } from '@/lib/bot/eval/replay-pairs'
import { MONS } from '@/lib/new/dates'
import { periodRange, type PeriodKey } from '@/lib/new/report'
import { useNew } from '../store'
import { useReport } from '../useReport'

const PERIODS: [PeriodKey, string][] = [['minggu-ini', 'Minggu ini'], ['minggu-lalu', 'Minggu lalu'], ['bulan-ini', 'Bulan ini'], ['bulan-lalu', 'Bulan lalu']]

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
  const maxT = R ? Math.max(1, ...R.trend.map((w) => w.inquiries)) : 1

  return (
    <section className="view fx" id="v-laporan">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <select className="sel" aria-label="Pilih periode" value={period} onChange={(e) => setPeriod(e.target.value as PeriodKey)}
          style={{ width: 'auto', padding: '5px 10px', fontSize: 13, borderRadius: 8 }}>
          {PERIODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <span className="mut sm">{fmt(from)} – {fmt(to)} {to.slice(0, 4)} · WIB</span>
      </div>

      <div className="grid g4" id="l-kpi" style={{ marginBottom: 12 }}>
        {([
          ['Inquiry baru', R ? R.inquiries : '…', 'chat WhatsApp pertama di periode ini'],
          ['Jadi booking', R ? R.inquiriesBooked : '…', 'dari inquiry periode ini, sampai hari ini'],
          ['Konversi', R ? conv + '%' : '…', 'inquiry → booking'],
          ['Booking dari WA', R ? R.bookings.length : '…', 'tanggal booking di periode ini'],
        ] as [string, string | number, string][]).map((k) => (
          <div key={k[0]} className="card kpi"><div className="l">{k[0]}</div><div className="v">{k[1]}</div><div className="d">{k[2]}</div></div>
        ))}
      </div>

      {error && <div className="card" style={{ color: 'var(--bad)', marginBottom: 12 }}>{error}</div>}

      <div className="grid g21">
        <div className="card" id="l-bookings">
          <h3>Customer dari WhatsApp yang booking</h3>
          <p className="hint">Awalnya chat WhatsApp, lalu booking. Nama membuka chat-nya di Inbox (bila ada di data contoh).</p>
          {loading ? <div className="mut" style={{ padding: 16 }}>Memuat…</div> : R && R.bookings.length ? (
            <div className="tw">
              <table>
                <thead><tr><th>Nama</th><th>Chat pertama</th><th>Booking</th><th>Jeda</th><th>Kode</th><th>Paket</th><th>Trip</th><th>Channel</th></tr></thead>
                <tbody>
                  {R.bookings.map((b) => (
                    <tr key={b.conversationId}>
                      <td><button type="button" onClick={() => st.openConv(b.name)} style={{ color: 'var(--accent)', fontWeight: 600, background: 'none', border: 0, padding: 0 }}>{b.name}</button><div className="mut sm">{b.phoneTail}</div></td>
                      <td className="sm">{fmt(b.firstChatDay)}</td>
                      <td className="sm">{fmt(b.bookingDay)}</td>
                      <td className="sm">{b.daysToBook === 0 ? 'hari sama' : b.daysToBook + ' hari'}</td>
                      <td className="sm">{b.bookingNumber}</td>
                      <td className="sm">{b.pkg}</td>
                      <td className="sm">{b.startYmd === '—' ? '—' : fmt(b.startYmd)}</td>
                      <td><span className="pill neu">{b.orderChannel}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <div className="mut" style={{ padding: 16, textAlign: 'center' }}>Belum ada booking dari chat WhatsApp di periode ini.</div>}
        </div>

        <div className="card" id="l-trend">
          <h3>Tren 8 minggu</h3>
          <p className="hint">Per minggu Senin–Minggu: inquiry baru dan booking yang awalnya dari chat.</p>
          {loading ? <div className="mut" style={{ padding: 16 }}>Memuat…</div> : R && R.trend.map((w) => (
            <div key={w.from} className="item" style={{ gridTemplateColumns: '74px minmax(0,1fr) auto' }}>
              <span className="mut sm">{fmt(w.from)}</span>
              <div aria-hidden="true" style={{ position: 'relative', height: 14, background: 'var(--neutral-bg)', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ position: 'absolute', inset: 0, width: (w.inquiries / maxT) * 100 + '%', background: 'var(--accent-soft)' }} />
                <div style={{ position: 'absolute', inset: 0, width: (w.booked / maxT) * 100 + '%', background: 'var(--good)' }} />
              </div>
              <span className="sm" style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}><b>{w.inquiries}</b> inquiry · <b style={{ color: 'var(--good)' }}>{w.booked}</b> booking</span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid g21" style={{ marginTop: 12 }}>
        <div className="card" id="l-leads">
          <h3>Belum booking: alasan & follow-up</h3>
          <p className="hint">Inquiry periode ini yang belum booking. Alasan dan rekomendasi dari ringkasan chat AI; yang belum dinilai AI disimpulkan dari pesan terakhir.</p>
          {loading ? <div className="mut" style={{ padding: 16 }}>Memuat…</div> : R && R.leads.length ? R.leads.map((l) => (
            <div key={l.conversationId} className="item" style={{ gridTemplateColumns: 'minmax(0,1fr)' }}>
              <div style={{ minWidth: 0 }}>
                <button type="button" onClick={() => st.openConv(l.name)} style={{ color: 'var(--accent)', fontWeight: 600, background: 'none', border: 0, padding: 0 }}>{l.name}</button>{' '}
                <span className="mut sm">{l.phoneTail} · chat {fmt(l.firstChatDay)}</span>{' '}
                <span className={'pill ' + (l.alasan === 'belum_dijawab' || l.alasan === 'menunggu_tim' ? 'bad' : l.alasan === 'harga' ? 'warn' : 'neu')}>{l.alasanText}</span>{' '}
                {l.lastFrom && (
                  <span className={'pill ' + (l.lastFrom === 'tamu' ? 'bad' : 'neu')}>
                    {l.lastFrom === 'tamu' ? 'Menunggu balasan kita' : 'Menunggu tamu'}{l.silentDays ? ' · ' + l.silentDays + ' hari' : ''}
                  </span>
                )}
                <p>{l.teks}</p>
                {l.rekomendasi && <p><b style={{ color: 'var(--ink)' }}>Follow-up:</b> {l.rekomendasi}</p>}
                <p className="sm">{l.sumber === 'ai' ? 'Dinilai AI' + (l.reviewDay ? ' ' + fmt(l.reviewDay) : '') : 'Belum dinilai AI'}</p>
              </div>
            </div>
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

      <p className="hint" style={{ marginTop: 12 }}>
        Inquiry = percakapan WhatsApp yang pesan masuk pertamanya jatuh di periode (vendor, crew, hotel yang dikenali ringkasan
        sebagai mitra tidak dihitung). Booking = tanggal booking sama atau sesudah hari chat pertama; tamu yang sudah booking sebelum
        chat tidak dihitung. Hanya booking terbaru per nomor yang tersimpan, dan data booking disegarkan bertahap tiap 5 menit.
        Alasan belum booking dan rekomendasi follow-up ditulis AI saat meringkas chat; rekomendasi hanya saran internal untuk
        tim, tidak pernah dikirim ke tamu. Semua angka di halaman ini data contoh.
      </p>
    </section>
  )
}

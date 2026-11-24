'use client'

// Menu Laporan: inquiry WhatsApp → booking. Halaman /new pertama yang memakai DATA ASLI
// (GET /api/new/report); definisi angka di src/lib/new/report.ts.
import { useEffect, useState } from 'react'
import { jakartaDay } from '@/lib/bot/eval/replay-pairs'
import { MONS } from '@/lib/new/dates'
import { periodRange, type PeriodKey, type Report } from '@/lib/new/report'

const PERIODS: [PeriodKey, string][] = [['minggu-ini', 'Minggu ini'], ['minggu-lalu', 'Minggu lalu'], ['bulan-ini', 'Bulan ini'], ['bulan-lalu', 'Bulan lalu']]

function fmt(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  if (!y || !m || !d) return ymd
  return d + ' ' + MONS[m - 1]
}

export function LaporanView() {
  const [period, setPeriod] = useState<PeriodKey>('minggu-ini')
  const today = jakartaDay(new Date())
  const { from, to } = periodRange(period, today)
  const key = from + '_' + to
  const [res, setRes] = useState<{ key: string; data?: Report; error?: string } | null>(null)

  useEffect(() => {
    let alive = true
    fetch(`/api/new/report?from=${from}&to=${to}`)
      .then(async (r) => {
        const j = await r.json()
        if (!alive) return
        if (!r.ok) setRes({ key, error: (j && j.error) || 'Gagal memuat laporan' })
        else setRes({ key, data: j as Report })
      })
      .catch(() => { if (alive) setRes({ key, error: 'Gagal memuat laporan' }) })
    return () => { alive = false }
  }, [from, to, key])

  const loading = !res || res.key !== key
  const R = !loading ? res?.data : undefined
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
        <span className="pill good" style={{ marginLeft: 'auto' }}>Data asli</span>
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

      {res?.error && !loading && <div className="card" style={{ color: 'var(--bad)', marginBottom: 12 }}>{res.error}</div>}

      <div className="grid g21">
        <div className="card">
          <h3>Customer dari WhatsApp yang booking</h3>
          <p className="hint">Awalnya chat WhatsApp, lalu booking. Nama membuka chat aslinya di Inbox.</p>
          {loading ? <div className="mut" style={{ padding: 16 }}>Memuat…</div> : R && R.bookings.length ? (
            <div className="tw">
              <table>
                <thead><tr><th>Nama</th><th>Chat pertama</th><th>Booking</th><th>Jeda</th><th>Kode</th><th>Paket</th><th>Trip</th><th>Channel</th></tr></thead>
                <tbody>
                  {R.bookings.map((b) => (
                    <tr key={b.conversationId}>
                      <td><a href={'/inbox?conversation=' + b.conversationId} style={{ color: 'var(--accent)', fontWeight: 600 }}>{b.name}</a><div className="mut sm">{b.phoneTail}</div></td>
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

        <div className="card">
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

      <p className="hint" style={{ marginTop: 12 }}>
        Inquiry = percakapan WhatsApp yang pesan masuk pertamanya jatuh di periode (vendor, crew, hotel yang dikenali ringkasan
        sebagai mitra tidak dihitung). Booking = tanggal booking sama atau sesudah hari chat pertama; tamu yang sudah booking sebelum
        chat tidak dihitung. Hanya booking terbaru per nomor yang tersimpan, dan data booking disegarkan bertahap tiap 5 menit.
      </p>
    </section>
  )
}

'use client'

import { KT } from '@/lib/new/mock-data'
import { useNew } from '../store'

export function KontakView() {
  const st = useNew()
  const { s, set } = st
  const q = s.kq.toLowerCase()
  const rows = KT.map((r, i) => ({ r, i })).filter(({ r }) => (!q || (r.n + r.kode).toLowerCase().includes(q)) && (!s.kl || r.lab === s.kl))
  return (
    <section className="view fx" id="v-kontak">
      <div className="toolbar" style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <input className="in" placeholder="Cari nama atau kode booking" style={{ maxWidth: 300 }} aria-label="Cari kontak"
          value={s.kq} onChange={(e) => { const v = e.target.value; set((d) => { d.kq = v }) }} />
        <select className="sel" style={{ maxWidth: 180 }} aria-label="Saring label" value={s.kl}
          onChange={(e) => { const v = e.target.value; set((d) => { d.kl = v }) }}>
          <option value="">Semua label</option>
          <option>Calon tamu</option>
          <option>Tamu</option>
          <option>Mitra</option>
        </select>
      </div>
      <div className="tw">
        <table>
          <thead><tr><th>Nama</th><th>Kanal</th><th>Label</th><th>Booking</th><th>Terakhir</th><th /></tr></thead>
          <tbody id="k-t">
            {rows.length ? rows.map(({ r, i }) => (
              <tr key={r.n} data-k={i} onClick={() => st.drawer({ kind: 'kontak', idx: i })}>
                <td><b>{r.n}</b></td>
                <td>{r.ch}</td>
                <td><span className="pill neu">{r.lab}</span></td>
                <td>{r.kode}</td>
                <td className="mut">{r.last}</td>
                <td style={{ textAlign: 'right' }}>
                  <button className="btn sm" data-kc={i} aria-label={'Buka chat ' + r.n} onClick={(e) => { e.stopPropagation(); st.openConv(r.n) }}>Chat</button>
                </td>
              </tr>
            )) : <tr><td colSpan={6} className="mut" style={{ textAlign: 'center', padding: 20 }}>Tidak ada kontak.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  )
}

'use client'

// Kontak: komposisi label sebagai saringan + kolom cari, lalu grid kartu kontak (daftar di ponsel).
import { initials } from '@/lib/new/logic'
import { KT } from '@/lib/new/mock-data'
import { SegBar } from '../Blocks'
import { useNew } from '../store'

const LABELS: [string, string][] = [['Tamu', 'var(--s1)'], ['Calon tamu', 'var(--s2)'], ['Mitra', 'var(--s3)']]
const AV: Record<string, string> = { Tamu: 'info', 'Calon tamu': 'warn', Mitra: '' }

export function KontakView() {
  const st = useNew()
  const { s, set } = st
  const q = s.kq.toLowerCase()
  const activeToday = KT.filter((r) => /menit|jam/.test(r.last)).length
  const rows = KT.map((r, i) => ({ r, i })).filter(({ r }) => (!q || (r.n + r.kode).toLowerCase().includes(q)) && (!s.kl || r.lab === s.kl))
  return (
    <section className="view fx" id="v-kontak">
      <div className="pg-card">
        <div className="pg-card-h">
          <h3>{KT.length} kontak</h3>
          <span className="mut sm">{activeToday} aktif hari ini</span>
        </div>
        <SegBar
          id="k-hk"
          active={s.kl || 'Semua'}
          total={{ key: 'Semua', label: 'Semua' }}
          onPick={(k) => set((d) => { d.kl = k === 'Semua' ? '' : k })}
          items={LABELS.map(([l, c]) => ({ key: l, label: l, n: KT.filter((r) => r.lab === l).length, color: c }))}
        />
        <input className="in" placeholder="Cari nama atau kode booking" aria-label="Cari kontak" style={{ marginTop: 10 }}
          value={s.kq} onChange={(e) => { const v = e.target.value; set((d) => { d.kq = v }) }} />
      </div>

      <div className="kt-grid" id="k-t">
        {rows.length ? rows.map(({ r, i }) => (
          <div key={r.n} className="kt-c" data-k={i} role="button" tabIndex={0}
            onClick={() => st.drawer({ kind: 'kontak', idx: i })}
            onKeyDown={(e) => { if (e.key === 'Enter') st.drawer({ kind: 'kontak', idx: i }) }}>
            <span className={'av ' + (AV[r.lab] || '')}>{initials(r.n)}</span>
            <div className="b">
              <b>{r.n}</b>
              <span className="m">{r.ch}{r.kode !== '—' ? ' · ' + r.kode : ''}</span>
              <span className="m">{r.ringkas}</span>
            </div>
            <div className="r">
              <span className="pill neu">{r.lab}</span>
              <span className="t">{r.last}</span>
              <button className="btn sm" data-kc={i} aria-label={'Buka chat ' + r.n} onClick={(e) => { e.stopPropagation(); st.openConv(r.n) }}>Chat</button>
            </div>
          </div>
        )) : <div className="pg-card mut" style={{ textAlign: 'center' }}>Tidak ada kontak.</div>}
      </div>
    </section>
  )
}

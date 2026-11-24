'use client'

// Jumbotron biru + baris KPI yang menumpang di bawahnya, sama dengan Dashboard /new, untuk dipakai
// halaman lain (kecuali Inbox). KPI yang punya onClick menjadi tombol; `on` = sedang dipilih (mis. tab).
import type { ViewKey } from '@/lib/new/types'
import { NAV_ICON } from './icons'

export interface HeroKpi {
  label: string
  value: React.ReactNode
  detail?: React.ReactNode
  /** gambar kecil di bawah angka: meter, batang bertumpuk, sparkline */
  visual?: React.ReactNode
  tone?: 'bad' | 'warn' | 'good'
  on?: boolean
  onClick?: () => void
}

export function PageHero({ view, kicker, title, sub, status, kpis, kpiId, right }: {
  view: ViewKey
  kicker?: React.ReactNode
  title: React.ReactNode
  sub?: React.ReactNode
  /** pill di kanan atas hero */
  status?: { text: string; off?: boolean; onClick?: () => void }
  kpis: HeroKpi[]
  kpiId?: string
  /** kontrol tambahan di kanan atas hero (mis. pilih periode) */
  right?: React.ReactNode
}) {
  return (
    <>
      <div className="db-hero">
        <svg className="hr" viewBox="0 0 24 24" aria-hidden="true">{NAV_ICON[view]}</svg>
        {kicker && <div className="hd">{kicker}</div>}
        <h2>{title}</h2>
        {sub && <p>{sub}</p>}
        {(status || right) && (
          <div className="db-hr">
            {right}
            {status && (
              status.onClick
                ? <button type="button" className={'st' + (status.off ? ' off' : '')} onClick={status.onClick}><i />{status.text}</button>
                : <span className={'st' + (status.off ? ' off' : '')}><i />{status.text}</span>
            )}
          </div>
        )}
      </div>
      <div className="db-kpi" id={kpiId} style={{ '--kc': String(Math.min(kpis.length, 5)) } as React.CSSProperties}>
        {kpis.map((k) => {
          const body = (
            <>
              <span className="l">{k.label}</span>
              <span className="r"><span className={'v' + (k.tone ? ' t-' + k.tone : '')}>{k.value}</span>{k.detail && <span className="d">{k.detail}</span>}</span>
              {k.visual}
            </>
          )
          return k.onClick
            ? <button key={k.label} type="button" className={'db-k' + (k.on ? ' on' : '')} aria-pressed={k.on} onClick={k.onClick}>{body}</button>
            : <div key={k.label} className="db-k static">{body}</div>
        })}
      </div>
    </>
  )
}

/** Meter tipis (0–100). */
export function Meter({ pct, color = 'var(--s3)' }: { pct: number; color?: string }) {
  return <span className="db-meter" aria-hidden="true"><span style={{ width: Math.max(0, Math.min(100, pct)) + '%', background: color }} /></span>
}

/** Batang bertumpuk dengan legenda angka (identitas tidak hanya dari warna). */
export function Stack({ parts }: { parts: { label: string; n: number; color: string }[] }) {
  return (
    <>
      <span className="db-stack" aria-hidden="true">
        {parts.map((p) => p.n ? <span key={p.label} style={{ flex: p.n, background: p.color }} /> : null)}
      </span>
      <span className="db-leg">{parts.map((p) => <span key={p.label}><i style={{ background: p.color }} />{p.label} <b>{p.n}</b></span>)}</span>
    </>
  )
}

/** Garis tren satu seri (tanpa legenda: judul KPI yang menamainya). */
export function Spark({ values }: { values: number[] }) {
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

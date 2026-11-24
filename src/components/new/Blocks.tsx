'use client'

// Blok tampilan bersama halaman /new: strip angka, batang komposisi (bisa jadi tab/saringan), dan
// grafik kolom tren. Palet seri --s1..--s4 (new.css) sudah divalidasi; angka selalu tertulis.
import { useState } from 'react'
import type { WeekPoint } from '@/lib/new/report'

const MONS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
export const d2 = (ymd: string) => { const [, m, d] = ymd.split('-').map(Number); return d + ' ' + MONS[m - 1] }

/** Banner status ala halaman Bot: ikon, satu kalimat utama, keterangan, dan kendali opsional di kanan. */
export function Banner({ icon, title, sub, tone = 'ok', right }: {
  icon: React.ReactNode
  title: React.ReactNode
  sub?: React.ReactNode
  tone?: 'ok' | 'off' | 'warn' | 'info'
  right?: React.ReactNode
}) {
  return (
    <div className={'bt-ban' + (tone === 'ok' ? '' : ' ' + tone)}>
      <span className="ic" aria-hidden="true"><svg viewBox="0 0 24 24">{icon}</svg></span>
      <div className="tx"><b>{title}</b>{sub && <span>{sub}</span>}</div>
      {right}
    </div>
  )
}

export interface StatItem {
  label: string
  value: React.ReactNode
  tone?: 'bad' | 'warn' | 'good'
  on?: boolean
  onClick?: () => void
}

/** Satu kartu, beberapa angka sejajar dipisah garis tipis. Ringkas untuk kepala halaman. */
export function StatStrip({ items, id, title }: { items: StatItem[]; id?: string; title?: React.ReactNode }) {
  return (
    <div className="pg-strip" id={id}>
      {title && <div className="pg-strip-t">{title}</div>}
      <div className="pg-strip-g" style={{ '--n': String(items.length) } as React.CSSProperties}>
        {items.map((it) => {
          const body = <><b className={it.tone ? 't-' + it.tone : undefined}>{it.value}</b><span>{it.label}</span></>
          return it.onClick
            ? <button key={it.label} type="button" className={'pg-st' + (it.on ? ' on' : '')} aria-pressed={!!it.on} onClick={it.onClick}>{body}</button>
            : <div key={it.label} className="pg-st">{body}</div>
        })}
      </div>
    </div>
  )
}

export interface SegItem {
  key: string
  label: string
  n: number
  color: string
}

/** Batang komposisi + legenda; bila `onPick` ada, legenda menjadi tab/saringan (tombol dengan .on). */
export function SegBar({ items, active, onPick, id, total }: { items: SegItem[]; active?: string; onPick?: (k: string) => void; id?: string; total?: { label: string; key: string; n?: number } }) {
  const sum = items.reduce((n, i) => n + i.n, 0)
  return (
    <div className="pg-seg">
      <div className="db-stack pg-seg-bar" aria-hidden="true">
        {items.map((i) => i.n ? <span key={i.key} style={{ flex: i.n, background: i.color, opacity: active && active !== i.key && active !== total?.key ? 0.35 : 1 }} /> : null)}
      </div>
      <div className="pg-seg-l" id={id}>
        {total && onPick && (
          <button type="button" className={active === total.key ? 'on' : ''} onClick={() => onPick(total.key)}>{total.label} <b>{total.n ?? sum}</b></button>
        )}
        {items.map((i) => onPick
          ? <button key={i.key} type="button" className={active === i.key ? 'on' : ''} onClick={() => onPick(i.key)}><i style={{ background: i.color }} />{i.label} <b>{i.n}</b></button>
          : <span key={i.key}><i style={{ background: i.color }} />{i.label} <b>{i.n}</b></span>)}
      </div>
    </div>
  )
}

/** Grafik kolom berpasangan inquiry vs booking per minggu, dengan tooltip hover. */
export function TrendChart({ data, onPick }: { data: WeekPoint[]; onPick?: () => void }) {
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


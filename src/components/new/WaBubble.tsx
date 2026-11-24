'use client'

// Pratinjau satu pesan WhatsApp: latar chat + gelembung keluar (hijau), format WA, gambar opsional,
// jam dan centang biru. Dipakai daftar dan editor Template pesan.
import { useState } from 'react'
import { waLines, type WaToken } from '@/lib/new/wa-format'

function Tok({ k }: { k: WaToken }) {
  if (k.t === 'b') return <strong>{k.v}</strong>
  if (k.t === 'i') return <em>{k.v}</em>
  if (k.t === 's') return <s>{k.v}</s>
  if (k.t === 'm') return <code>{k.v}</code>
  if (k.t === 'link') return <span className="wa-l">{k.v}</span>
  return <>{k.v}</>
}

export function WaBubble({ text, imageUrl, clamp = false, time = '10.12', dir = 'out' }: { text: string; imageUrl?: string | null; clamp?: boolean; time?: string; dir?: 'out' | 'in' }) {
  const [more, setMore] = useState(false)
  const lines = waLines(text)
  const long = clamp && lines.length > 12
  const shown = long && !more ? lines.slice(0, 10) : lines
  return (
    <div className={'wa-chat' + (dir === 'in' ? ' in' : '')}>
      <div className={'wa-b' + (dir === 'in' ? ' in' : '')}>
        {imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- gambar template dari host legacy; pratinjau saja
          <img className="wa-img" src={imageUrl} alt="" loading="lazy" />
        )}
        <div className="wa-t">
          {shown.map((l, i) => <div key={i} className="wa-ln">{l.length ? l.map((k, j) => <Tok key={j} k={k} />) : ' '}</div>)}
          {long && (
            <button type="button" className="wa-more" onClick={(e) => { e.stopPropagation(); setMore((m) => !m) }}>
              {more ? 'Tutup' : 'Baca selengkapnya'}
            </button>
          )}
        </div>
        <span className="wa-meta">{time}{dir === 'in' ? null : <svg viewBox="0 0 16 11" aria-hidden="true"><path d="M11.07.65 4.6 7.12 1.93 4.45.5 5.88l4.1 4.1 7.9-7.9zM15.07.65 8.6 7.12l-.8-.8-1.43 1.43 2.23 2.23 7.9-7.9z" /></svg>}</span>
      </div>
    </div>
  )
}

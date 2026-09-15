'use client'
import { useRef, useState, type CSSProperties } from 'react'
import { cn } from '@/lib/utils'

// Piksel per detik yang dianggap nyaman dibaca sambil bergulir -- dipakai untuk menurunkan
// durasi animasi dari jarak sesungguhnya, bukan durasi tetap yang membuat nama pendek
// bergulir terlalu lambat dan nama sangat panjang terlalu cepat untuk dibaca.
const MARQUEE_PIXELS_PER_SECOND = 45
const MARQUEE_MIN_DURATION_S = 2.5

/**
 * Satu baris teks yang terpotong `...` saat diam, dan bergulir horizontal sampai ujung lalu
 * kembali saat pointer/keyboard fokus berada di atasnya -- HANYA kalau teksnya benar-benar
 * melebihi lebar yang tersedia (`scrollWidth > clientWidth`), diukur lewat ref, bukan ditebak
 * dari panjang string. `title` selalu berisi teks penuh sebagai jaring pengaman aksesibilitas
 * (mis. saat prefers-reduced-motion mematikan animasinya di seluruh aplikasi, lihat
 * globals.css) dan sebagai tooltip native selagi pointer/fokus belum lama berada di sana.
 *
 * Sengaja TIDAK punya elemen atau tab stop interaktif sendiri -- dipakai di dalam <button>
 * baris daftar percakapan, dan menambah `tabIndex` di sini akan menggandakan tab stop pada
 * baris yang sama. Hover/fokus yang memicu animasi ini datang dari pointer yang sungguh
 * berada di atas teksnya sendiri (mouseenter tidak bubble, jadi ini aman dipasang di sini
 * tanpa memicu diri sendiri dari elemen tetangga).
 */
export function MarqueeText({ text, className }: { text: string; className?: string }) {
  const textRef = useRef<HTMLSpanElement>(null)
  const [marqueeDistance, setMarqueeDistance] = useState<number | null>(null)

  function measureAndMaybeStart() {
    const el = textRef.current
    if (!el) return
    const distance = el.scrollWidth - el.clientWidth
    if (distance > 0) setMarqueeDistance(distance)
  }

  function stop() {
    setMarqueeDistance(null)
  }

  const isScrolling = marqueeDistance !== null
  const style: CSSProperties | undefined = isScrolling
    ? ({
        '--marquee-distance': `${marqueeDistance}px`,
        animationDuration: `${Math.max(MARQUEE_MIN_DURATION_S, marqueeDistance / MARQUEE_PIXELS_PER_SECOND)}s`,
      } as CSSProperties)
    : undefined

  return (
    <span
      className="block max-w-full overflow-hidden"
      onMouseEnter={measureAndMaybeStart}
      onMouseLeave={stop}
      onFocus={measureAndMaybeStart}
      onBlur={stop}
    >
      <span
        ref={textRef}
        title={text}
        style={style}
        className={cn(
          isScrolling ? 'inline-block w-max animate-marquee whitespace-nowrap' : 'block w-full truncate',
          className
        )}
      >
        {text}
      </span>
    </span>
  )
}

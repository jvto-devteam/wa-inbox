'use client'
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
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
 * baris yang sama. Hover dideteksi lewat mouseenter/mouseleave langsung di elemen ini (aman
 * dipasang di sini tanpa memicu diri sendiri dari elemen tetangga, karena mouseenter tidak
 * bubble). Fokus keyboard TIDAK bisa dideteksi lewat onFocus/onBlur React di elemen ini:
 * teks ini sendiri bukan kontrol, jadi fokus tidak pernah mendarat di sini -- dan sebuah
 * event fokus mengalir NAIK dari elemen yang benar-benar difokus ke leluhurnya, tidak
 * pernah turun ke keturunan seperti span ini. Jadi begitu mount, komponen ini mencari
 * leluhur interaktif terdekat lewat DOM (`closest('button, a, [tabindex]')`) dan memasang
 * listener `focusin`/`focusout` LANGSUNG di elemen itu -- bukan di dirinya sendiri, dan
 * tanpa menambah tab stop apa pun. Kalau tidak ada leluhur interaktif (mis. header
 * ThreadView, ContactPanel), hover tetap jalan dan tidak ada listener fokus mati yang
 * dipasang.
 */
export function MarqueeText({ text, className }: { text: string; className?: string }) {
  const wrapperRef = useRef<HTMLSpanElement>(null)
  const textRef = useRef<HTMLSpanElement>(null)
  const [marqueeDistance, setMarqueeDistance] = useState<number | null>(null)

  const measureAndMaybeStart = useCallback(() => {
    const el = textRef.current
    if (!el) return
    const distance = el.scrollWidth - el.clientWidth
    if (distance > 0) setMarqueeDistance(distance)
  }, [])

  const stop = useCallback(() => setMarqueeDistance(null), [])

  useEffect(() => {
    const interactiveAncestor = wrapperRef.current?.closest('button, a, [tabindex]')
    if (!interactiveAncestor) return
    interactiveAncestor.addEventListener('focusin', measureAndMaybeStart)
    interactiveAncestor.addEventListener('focusout', stop)
    return () => {
      interactiveAncestor.removeEventListener('focusin', measureAndMaybeStart)
      interactiveAncestor.removeEventListener('focusout', stop)
    }
  }, [measureAndMaybeStart, stop])

  const isScrolling = marqueeDistance !== null
  const style: CSSProperties | undefined = isScrolling
    ? ({
        '--marquee-distance': `${marqueeDistance}px`,
        animationDuration: `${Math.max(MARQUEE_MIN_DURATION_S, marqueeDistance / MARQUEE_PIXELS_PER_SECOND)}s`,
      } as CSSProperties)
    : undefined

  return (
    <span
      ref={wrapperRef}
      className="block max-w-full overflow-hidden"
      onMouseEnter={measureAndMaybeStart}
      onMouseLeave={stop}
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

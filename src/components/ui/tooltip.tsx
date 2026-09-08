import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

/**
 * Tooltip tanpa dependensi baru: satu span berposisi absolut yang muncul saat pemicunya
 * di-hover ATAU menerima fokus keyboard (group-focus-within), jadi ia tidak hilang bagi
 * orang yang tidak memakai tetikus.
 *
 * Dua batasan yang disengaja, dan keduanya harus diketahui Tahap 1B/1C:
 *
 *  1. Isinya `aria-hidden`. Tooltip di sini adalah pengingat visual, BUKAN sumber nama
 *     aksesibel. Pemicunya wajib punya namanya sendiri -- <IconButton label=".."> sudah
 *     memaksa itu. Kalau teks tooltip adalah satu-satunya penjelasan yang ada, itu bukan
 *     tooltip, itu label, dan harus ditulis di layar.
 *  2. Diposisikan dengan CSS biasa, bukan dengan pengukuran viewport. Di dalam induk yang
 *     `overflow-hidden`/scroll ia akan terpotong. Untuk toolbar dan kepala tabel -- tempat
 *     tooltip sebenarnya dipakai -- ini cukup. Kalau nanti benar-benar butuh tooltip di
 *     dalam daftar yang menggulung, itu perlu popover berposisi sungguhan, dan itu keputusan
 *     tersendiri (kemungkinan besar berarti memasang pustaka positioning).
 */
type Side = 'top' | 'bottom' | 'left' | 'right'

const sideClasses: Record<Side, string> = {
  top: 'bottom-full left-1/2 mb-1.5 -translate-x-1/2',
  bottom: 'top-full left-1/2 mt-1.5 -translate-x-1/2',
  left: 'right-full top-1/2 mr-1.5 -translate-y-1/2',
  right: 'left-full top-1/2 ml-1.5 -translate-y-1/2',
}

export function Tooltip({
  content,
  side = 'top',
  children,
  className,
}: {
  content: ReactNode
  side?: Side
  children: ReactNode
  className?: string
}) {
  return (
    <span className={cn('group relative inline-flex', className)}>
      {children}
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none invisible absolute z-50 rounded-sm bg-ink px-2 py-1 text-xs font-medium whitespace-nowrap text-white opacity-0 shadow-popover',
          'transition-opacity duration-100 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100',
          sideClasses[side]
        )}
      >
        {content}
      </span>
    </span>
  )
}

'use client'
import Link from 'next/link'
import { ArrowRight, Unplug } from 'lucide-react'
import type { ReactNode } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

/**
 * Cangkang satu panel Beranda.
 *
 * Bukan pembungkus dekoratif: ia memaksa tiga hal yang harus sama di sembilan panel sekaligus —
 * kepala yang selalu punya judul dan (hampir selalu) satu tautan keluar ke tempat pekerjaannya,
 * garis rambut yang memisahkan kepala dari isi, dan tinggi yang mengisi selnya sehingga baris
 * grid tidak bergerigi. Tanpa ini, sembilan panel akan menulis kepalanya masing-masing dan
 * berbeda satu sama lain persis seperti tujuh belas judul halaman sebelum PageHeader ada.
 */
export function Panel({
  title,
  subtitle,
  href,
  hrefLabel,
  actions,
  className,
  bodyClassName,
  children,
}: {
  title: string
  subtitle?: ReactNode
  /** Ke mana pekerjaan panel ini sebenarnya dikerjakan. Panel tanpa tujuan adalah angka mati. */
  href?: string
  hrefLabel?: string
  actions?: ReactNode
  className?: string
  bodyClassName?: string
  children: ReactNode
}) {
  return (
    <section className={cn('flex min-w-0 flex-col rounded-lg border border-line bg-surface', className)}>
      <div className="flex items-start gap-3 border-b border-line px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          {subtitle && <p className="truncate text-xs text-ink-muted">{subtitle}</p>}
        </div>
        {actions}
        {href && (
          <Link
            href={href}
            className="focus-ring mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-sm text-sm text-ink-muted transition-colors hover:text-ink"
          >
            <span className="hidden sm:inline">{hrefLabel ?? 'Buka'}</span>
            <ArrowRight aria-hidden="true" className="size-3.5" strokeWidth={1.75} />
          </Link>
        )}
      </div>
      <div className={cn('flex-1', bodyClassName ?? 'p-4')}>{children}</div>
    </section>
  )
}

/**
 * Panel yang datanya tidak sampai.
 *
 * Ia mengaku sendiri dan tidak menjatuhkan halaman: delapan panel lain di sekitarnya membaca
 * endpoint yang berbeda dan tetap benar. Yang TIDAK boleh dilakukan di sini adalah menampilkan
 * nol — nol dan "tidak tahu" adalah dua keadaan yang berbeda, dan hanya salah satunya yang
 * berarti "semuanya beres".
 */
export function PanelError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-start gap-1.5">
      <p className="flex items-center gap-2 text-base font-medium text-ink">
        <Unplug aria-hidden="true" className="size-4 shrink-0 text-ink-subtle" strokeWidth={1.75} />
        Data tidak bisa dibaca
      </p>
      <p className="text-sm text-ink-muted">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="focus-ring rounded-sm text-sm font-medium text-accent hover:text-accent-hover"
        >
          Coba lagi
        </button>
      )}
    </div>
  )
}

/** Isi panel saat masih memuat: bentuk isinya, bukan spinner. */
export function PanelLoading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className={cn('h-3.5', i % 3 === 2 ? 'w-2/5' : i % 3 === 1 ? 'w-3/5' : 'w-4/5')} />
      ))}
    </div>
  )
}

/**
 * Satu angka besar dengan labelnya. Mono, karena empat di antaranya berjajar dan angka Poppins
 * yang proporsional membuat kolomnya bergoyang.
 */
export function Stat({
  value,
  label,
  tone = 'ink',
}: {
  value: string
  label: string
  tone?: 'ink' | 'muted' | 'success' | 'warning' | 'danger'
}) {
  const toneClass = {
    ink: 'text-ink',
    muted: 'text-ink-muted',
    success: 'text-success',
    warning: 'text-warning',
    danger: 'text-danger',
  }[tone]

  return (
    <div className="min-w-0">
      <p className={cn('font-mono text-lg leading-none font-semibold tabular-nums', toneClass)}>{value}</p>
      <p className="mt-1 truncate text-xs text-ink-muted">{label}</p>
    </div>
  )
}

/**
 * Pemilih rentang. Tiga tombol, bukan <Select>: nilainya hanya tiga, dipindah-pindah berkali-kali
 * dalam satu sesi, dan sebuah dropdown menyembunyikan dua di antaranya di balik satu klik ekstra
 * setiap kali. Segmen aktif memakai aksen dengan alasan yang sama seperti nav aktif — ia menjawab
 * "saya sedang melihat yang mana".
 */
export function RangeSwitch({
  value,
  options,
  onChange,
  disabled,
}: {
  value: number
  options: readonly number[]
  onChange: (next: number) => void
  disabled?: boolean
}) {
  return (
    <div
      role="group"
      aria-label="Rentang waktu"
      className="inline-flex h-8 shrink-0 items-center gap-px overflow-hidden rounded-md border border-line-strong bg-line"
    >
      {options.map((option) => {
        const active = option === value
        return (
          <button
            key={option}
            type="button"
            disabled={disabled}
            aria-pressed={active}
            onClick={() => onChange(option)}
            className={cn(
              'focus-ring h-full px-2.5 text-sm font-medium tabular-nums transition-colors disabled:cursor-not-allowed',
              active
                ? 'bg-accent-subtle text-accent'
                : 'bg-surface text-ink-muted hover:bg-surface-sunken hover:text-ink'
            )}
          >
            {option} hari
          </button>
        )
      })}
    </div>
  )
}

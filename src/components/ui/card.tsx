import { cn } from '@/lib/utils'
import type { HTMLAttributes } from 'react'

/**
 * Pengelompokan sungguhan -- BUKAN pembungkus default.
 *
 * Kalau isinya daftar, pakai daftar dengan garis rambut. Kalau isinya tabel, pakai <Table>.
 * Card dipakai hanya kalau beberapa hal yang berbeda jenis memang perlu diikat jadi satu
 * blok. Tidak ada bayangan di sini: yang memisahkan Card dari canvas adalah garisnya.
 */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-lg border border-line bg-surface', className)} {...props} />
}

/** Kepala Card: judul + aksi, dipisah garis rambut dari isinya. */
export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex items-center justify-between gap-3 border-b border-line px-4 py-2.5', className)}
      {...props}
    />
  )
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn('text-base font-semibold text-ink', className)} {...props} />
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-4', className)} {...props} />
}

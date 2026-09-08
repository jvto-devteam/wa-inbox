import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

/**
 * Kepala halaman: tautan kembali (opsional), judul, deskripsi (opsional), aksi (opsional).
 *
 * Alasan komponen ini ada: sebelum Tahap 1B, 17 halaman menulis judulnya masing-masing dengan
 * `<h1 className="text-xl font-semibold text-navy">` yang disalin tangan, sebagian dibungkus
 * `<div className="space-y-1">` dengan tautan kembali di atasnya dan sebagian tidak, dan tidak
 * satu pun punya tempat baku untuk aksi tingkat halaman — tombol dan filter akhirnya menempel
 * di mana pun penulis halamannya menaruhnya. Tujuh belas salinan dari satu keputusan desain
 * berarti tujuh belas kesempatan untuk berbeda; setelah ini ada satu.
 *
 * Perubahan rupa yang ikut dibawa, serentak di semua halaman:
 *  - `text-lg` (17px), bukan `text-xl` (20px). 17px adalah "judul halaman" di skala tipografi
 *    Tahap 1A; 20px adalah sisa dari skala lama.
 *  - `text-ink`, bukan alias lama `text-navy` (nilainya identik, namanya yang sekarang benar).
 *  - Tautan kembali tidak lagi berwarna aksen. Aksen hanya dibelanjakan untuk nav aktif, aksi
 *    utama, dan penanda belum dibaca; "kembali" bukan satu pun dari ketiganya.
 *
 * `actions` sengaja `ReactNode` dan bukan daftar tombol berstruktur: halaman-halaman ini
 * memasang hal yang berbeda-beda di sana (tombol, <Select> filter, lencana status), dan
 * memaksakan satu bentuk hanya akan membuat setengahnya mengakalinya.
 */
export function PageHeader({
  title,
  description,
  backHref,
  backLabel,
  leading,
  actions,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  backHref?: string
  backLabel?: string
  /** Elemen sebelum judul — hari ini hanya avatar di /contacts/<id>. */
  leading?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <header className={cn('space-y-1', className)}>
      {backHref && (
        <Link
          href={backHref}
          className="focus-ring inline-flex items-center gap-1 rounded-sm text-sm text-ink-muted hover:text-ink"
        >
          <ArrowLeft aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={1.75} />
          {backLabel ?? 'Kembali'}
        </Link>
      )}
      <div className={cn('flex gap-3', leading ? 'items-center' : 'items-start')}>
        {leading}
        <div className="min-w-0 space-y-1">
          <h1 className="text-lg font-semibold text-ink">{title}</h1>
          {description && <div className="text-sm text-ink-muted">{description}</div>}
        </div>
        {/* Aksi selalu di kanan atas, di setiap halaman, tanpa kecuali. Kalau sebuah halaman
            tidak punya aksi, kotak ini tidak dirender sama sekali — bukan kotak kosong yang
            diam-diam menggeser judulnya. */}
        {actions && <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </header>
  )
}

import { cn } from '@/lib/utils'

/**
 * Placeholder saat memuat. `animate-pulse` sudah otomatis berhenti saat
 * prefers-reduced-motion: reduce -- aturannya global di globals.css, bukan per komponen.
 *
 * Halaman yang membutuhkannya: /inbox (daftar percakapan dan thread sebelum fetch pertama
 * selesai), /dashboard (kartu angka), /bot-control/* (tabel yang dipaginasi -- baris kosong
 * yang melompat-lompat adalah keluhan yang paling sering terlihat di antrean).
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      role="presentation"
      className={cn('animate-pulse rounded-sm bg-surface-sunken', className)}
    />
  )
}

/**
 * Beberapa baris teks palsu dengan lebar berbeda -- baris terakhir sengaja lebih pendek,
 * karena blok yang semua barisnya sama panjang terbaca sebagai tabel, bukan paragraf.
 */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn('h-3', i === lines - 1 ? 'w-2/5' : 'w-full')} />
      ))}
    </div>
  )
}

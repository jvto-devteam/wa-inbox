import { cn } from '@/lib/utils'
import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react'

/**
 * Wadah baku sebuah tabel — satu permukaan berbatas di atas kanvas.
 *
 * Bentuknya diangkat apa adanya dari `src/components/contacts/ContactTable.tsx`, halaman yang
 * dipakai pemilik sebagai patokan: `overflow-hidden rounded-lg border border-line bg-surface`.
 * Sebelum ini pola yang sama ditulis ulang sendiri-sendiri di Kontak, Manajemen pengguna, dan
 * Histori Biaya — dan tidak ditulis sama sekali di enam halaman Bot Control, yang karena itu
 * tabelnya mengambang langsung di kanvas dan terbaca "asal taruh".
 *
 * `overflow-hidden` bukan hiasan: tanpa itu baris pertama/terakhir (dan latar hover-nya)
 * menonjol keluar dari sudut yang dibulatkan.
 *
 * Keadaan kosong dan keadaan memuat sebuah tabel duduk DI DALAM wadah ini juga, bukan di
 * sebelahnya: kotaknya tidak boleh muncul dan menghilang mengikuti ada-tidaknya baris.
 *
 * Yang TIDAK boleh: menaruh <Card> lagi di dalam atau di luar wadah ini. Satu tabel butuh satu
 * kotak.
 */
export function TableContainer({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('overflow-hidden rounded-lg border border-line bg-surface', className)} {...props} />
  )
}

/**
 * Tabel adalah tabel: baris 36px, sel 8px/12px, dipisah garis rambut. Tidak dibungkus Card,
 * tidak diberi bayangan. Angka di dalamnya tabular (diset di globals.css untuk semua
 * <table>) supaya kolom harga/jumlah benar-benar sejajar.
 */
export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="relative w-full overflow-x-auto">
      <table className={cn('w-full caption-bottom border-collapse text-base', className)} {...props} />
    </div>
  )
}

export function TableHeader({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn('[&_tr]:border-b [&_tr]:border-line', className)} {...props} />
}

export function TableBody({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn('[&_tr:last-child]:border-0', className)} {...props} />
}

export function TableRow({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn('h-9 border-b border-line transition-colors hover:bg-surface-sunken', className)} {...props} />
}

export function TableHead({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        'h-8 px-3 py-2 text-left align-middle text-xs font-medium tracking-wide text-ink-subtle uppercase',
        className
      )}
      {...props}
    />
  )
}

export function TableCell({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('px-3 py-2 align-middle', className)} {...props} />
}

import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

/**
 * Satu bagian dari sebuah formulir: judul, penjelasan singkat, lalu isinya.
 *
 * --- Kenapa ini panel berbatas, bukan seksi telanjang ---
 *
 * Versi pertama memakai garis rambut di ATAS tiap bagian, tanpa wadah, mengambang langsung di
 * kanvas. Alasannya waktu itu "bukan semuanya kartu". Itu aturan yang benar untuk kartu di
 * dalam kartu, tapi diterapkan terlalu jauh di sini: pemilik membukanya dan bilang isinya
 * "kayak asal taruh aja" dibandingkan Beranda, Inbox, Kontak, dan Template.
 *
 * Ia benar, dan sebabnya bisa ditunjuk. Keempat halaman itu semuanya menempatkan isinya di
 * dalam permukaan berbatas di atas kanvas (`Panel` di Beranda, wadah tabel di Kontak). Halaman
 * formulir memakai pemisah yang berbeda sendiri — dan di grid dua kolom, garis atas itu tidak
 * pernah sejajar antar-kolom karena tinggi tiap bagian berbeda, sehingga terbaca sebagai
 * potongan yang diletakkan sembarangan alih-alih satu sistem.
 *
 * Bentuk kepalanya sengaja dibuat sama persis dengan `src/components/dashboard/Panel.tsx`:
 * judul `text-base font-semibold`, penjelasan kecil di bawahnya, dipisah garis rambut dari
 * isinya. Kalau salah satu berubah, yang lain harus ikut.
 *
 * `actions` untuk aksi tingkat bagian (mis. "Sinkron Sekarang"). Aksi utama tiap bagian
 * cukup satu; sisanya outline atau ghost.
 */
export function FormSection({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: string
  description?: ReactNode
  actions?: ReactNode
  children?: ReactNode
  className?: string
}) {
  return (
    <section className={cn('flex min-w-0 flex-col rounded-lg border border-line bg-surface', className)}>
      <div className="flex flex-wrap items-start gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1 space-y-0.5">
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          {description ? <p className="max-w-2xl text-sm text-ink-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {children ? <div className="flex-1 p-4">{children}</div> : null}
    </section>
  )
}

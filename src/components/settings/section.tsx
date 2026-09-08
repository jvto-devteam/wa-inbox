import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

/**
 * Satu bagian dari sebuah formulir: judul, penjelasan singkat, lalu isinya.
 *
 * Halaman pengaturan (Pengaturan, Chatbot, Profil bisnis, Histori biaya) adalah formulir,
 * bukan dasbor. Sebelumnya setiap setelan dibungkus <Card> sendiri-sendiri, jadi satu layar
 * berisi enam kotak ber-radius yang saling bersaing padahal semuanya satu formulir yang sama.
 * Yang memisahkan bagian di sini adalah garis rambut dan jarak — persis seperti sisa sistem.
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
    <section className={cn('border-t border-line pt-6 first:border-t-0 first:pt-0', className)}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          {description ? <p className="max-w-2xl text-sm text-ink-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {children ? <div className="mt-4">{children}</div> : null}
    </section>
  )
}

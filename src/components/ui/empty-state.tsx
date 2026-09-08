import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

/**
 * Keadaan kosong yang seragam. Hari ini setiap halaman menuliskannya sendiri dengan nada
 * berbeda ("Belum ada data", "Tidak ada hasil", satu <p> abu-abu di tengah), dan operator
 * jadi tidak bisa membedakan "filternya terlalu sempit" dari "memang belum ada apa-apa".
 *
 * Halaman yang membutuhkannya: /inbox (daftar percakapan kosong / hasil pencarian kosong),
 * /contacts, /templates, /bot-control/audit-logs, /bot-control/decisions,
 * /bot-control/outbound-queue, /settings/knowledge-gaps.
 *
 * `action` sengaja opsional: keadaan kosong yang benar-benar tidak punya jalan keluar
 * (mis. antrean outbound yang memang bersih) lebih baik diam daripada menawarkan tombol
 * palsu.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-1.5 px-6 py-10 text-center',
        className
      )}
    >
      {icon ? (
        <span className="mb-1 flex size-8 items-center justify-center text-ink-subtle [&_svg]:size-5" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <p className="text-base font-medium text-ink">{title}</p>
      {description ? <p className="max-w-xs text-sm text-ink-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}

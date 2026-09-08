import { cn } from '@/lib/utils'
import type { HTMLAttributes } from 'react'

/**
 * Penanda status yang rapat. Varian dipertahankan (30 berkas memakainya); yang berubah
 * bentuknya: bukan pil ber-radius 32px lagi, tapi persegi 4px seperti sisa sistem.
 *
 * `brand` sengaja tetap ada sebagai nama lama untuk aksen, tapi pakailah seperlunya --
 * badge bukan salah satu dari tiga tempat aksen boleh dibelanjakan.
 */
type Variant = 'default' | 'brand' | 'success' | 'warning' | 'destructive' | 'muted'

const variantClasses: Record<Variant, string> = {
  default: 'bg-surface-sunken text-ink',
  brand: 'bg-accent-subtle text-accent',
  success: 'bg-success-subtle text-success',
  warning: 'bg-warning-subtle text-warning',
  destructive: 'bg-danger-subtle text-danger',
  muted: 'bg-surface-sunken text-ink-muted',
}

export function Badge({
  variant = 'default',
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { variant?: Variant }) {
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1 rounded-sm px-1.5 text-xs font-medium whitespace-nowrap tabular-nums',
        variantClasses[variant],
        className
      )}
      {...props}
    />
  )
}

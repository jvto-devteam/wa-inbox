import { cn } from '@/lib/utils'
import type { ButtonHTMLAttributes } from 'react'

/**
 * Varian dan ukuran DIPERTAHANKAN persis seperti sebelumnya -- 67 pemanggilan di 25 berkas
 * bergantung padanya. Yang berubah hanya rupanya.
 *
 * `default` sekarang memakai aksen, bukan navy. Itu konsekuensi langsung dari aturan
 * "aksen dibelanjakan untuk aksi utama": tombol tanpa varian ADALAH aksi utama halaman.
 * Kalau sebuah halaman punya tiga tombol default berjajar, yang salah halamannya, bukan
 * tombolnya -- dua di antaranya seharusnya `outline`.
 */
type Variant = 'default' | 'outline' | 'secondary' | 'ghost' | 'destructive'
type Size = 'default' | 'sm' | 'lg' | 'icon'

const variantClasses: Record<Variant, string> = {
  default: 'bg-accent text-white hover:bg-accent-hover active:bg-accent-hover',
  outline: 'border border-line-strong bg-surface text-ink hover:bg-surface-sunken',
  secondary: 'bg-surface-sunken text-ink hover:bg-line',
  ghost: 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
  destructive: 'bg-danger-subtle text-danger hover:bg-danger hover:text-white',
}

// 32px default / 28px kecil / 36px besar -- target kepadatan sistem desain.
const sizeClasses: Record<Size, string> = {
  default: 'h-8 px-3 text-base',
  sm: 'h-7 px-2.5 text-sm',
  lg: 'h-9 px-4 text-base',
  icon: 'size-8 p-0',
}

export function Button({
  variant = 'default',
  size = 'default',
  className,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return (
    <button
      type={type}
      className={cn(
        'focus-ring inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors',
        'disabled:pointer-events-none disabled:border-line disabled:bg-surface-sunken disabled:text-ink-subtle',
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
      {...props}
    />
  )
}

import { cn } from '@/lib/utils'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

/**
 * Tombol yang isinya cuma ikon. Dipisahkan dari <Button size="icon"> karena satu alasan:
 * `label` di sini WAJIB. Tombol ikon tanpa nama yang bisa dibaca adalah tombol yang tidak
 * ada bagi pembaca layar, dan di aplikasi ini tombol-tombol itu memegang aksi sungguhan
 * (tutup dialog, salin nomor, buka menu percakapan).
 *
 * Halaman yang membutuhkannya hari ini: /inbox (aksi di kepala percakapan dan di ComposeBox),
 * /bot-control/outbound-queue (retry/batal per baris), /templates (hapus varian).
 */
type Variant = 'ghost' | 'outline' | 'default' | 'destructive'
type Size = 'sm' | 'default' | 'lg'

const variantClasses: Record<Variant, string> = {
  ghost: 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
  outline: 'border border-line-strong bg-surface text-ink-muted hover:bg-surface-sunken hover:text-ink',
  default: 'bg-accent text-white hover:bg-accent-hover',
  destructive: 'text-danger hover:bg-danger-subtle',
}

// 28 / 32 / 36 -- sama persis dengan tinggi <Button>, supaya keduanya bisa berjajar rata.
const sizeClasses: Record<Size, string> = {
  sm: 'size-7',
  default: 'size-8',
  lg: 'size-9',
}

export function IconButton({
  label,
  icon,
  variant = 'ghost',
  size = 'default',
  className,
  type = 'button',
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  label: string
  icon: ReactNode
  variant?: Variant
  size?: Size
}) {
  return (
    <button
      type={type}
      aria-label={label}
      className={cn(
        'focus-ring inline-flex shrink-0 items-center justify-center rounded-md transition-colors',
        'disabled:pointer-events-none disabled:border-line disabled:bg-surface-sunken disabled:text-ink-subtle',
        '[&_svg]:size-4 [&_svg]:shrink-0',
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
      {...props}
    >
      {icon}
    </button>
  )
}

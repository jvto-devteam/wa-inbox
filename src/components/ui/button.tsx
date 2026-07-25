import { cn } from '@/lib/utils'
import type { ButtonHTMLAttributes } from 'react'

type Variant = 'default' | 'outline' | 'secondary' | 'ghost' | 'destructive'
type Size = 'default' | 'sm' | 'icon'

const variantClasses: Record<Variant, string> = {
  default: 'bg-navy text-white hover:bg-navy-light',
  outline: 'border border-input bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-slate-200',
  ghost: 'hover:bg-muted hover:text-foreground',
  destructive: 'bg-destructive/10 text-destructive hover:bg-destructive/20',
}

const sizeClasses: Record<Size, string> = {
  default: 'h-8 px-3.5 text-sm',
  sm: 'h-7 px-2.5 text-xs',
  icon: 'size-8',
}

export function Button({
  variant = 'default',
  size = 'default',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:pointer-events-none disabled:opacity-50',
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
      {...props}
    />
  )
}

import { cn } from '@/lib/utils'
import type { HTMLAttributes } from 'react'

type Variant = 'default' | 'brand' | 'success' | 'warning' | 'destructive' | 'muted'

const variantClasses: Record<Variant, string> = {
  default: 'bg-secondary text-secondary-foreground',
  brand: 'bg-brand/10 text-brand',
  success: 'bg-emerald-50 text-emerald-700',
  warning: 'bg-amber-50 text-amber-700',
  destructive: 'bg-red-50 text-red-700',
  muted: 'bg-slate-100 text-slate-600',
}

export function Badge({ variant = 'default', className, ...props }: HTMLAttributes<HTMLSpanElement> & { variant?: Variant }) {
  return <span className={cn('badge', variantClasses[variant], className)} {...props} />
}

import { cn } from '@/lib/utils'
import type { SelectHTMLAttributes } from 'react'

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn('h-8 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-brand', className)}
      {...props}
    />
  )
}

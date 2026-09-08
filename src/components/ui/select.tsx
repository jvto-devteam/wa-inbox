import { cn } from '@/lib/utils'
import { forwardRef } from 'react'
import type { SelectHTMLAttributes } from 'react'

/**
 * <select> native dengan panah sendiri (lihat .select-chevron di globals.css). Panah bawaan
 * OS berbeda-beda tinggi dan warnanya di macOS/Windows/Linux, dan itu satu-satunya kontrol
 * di layar ini yang tidak bisa disamakan tanpa mengganti panahnya.
 */
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, ...props }, ref) {
    return (
      <select
        ref={ref}
        className={cn(
          'field-focus select-chevron h-8 rounded-md border border-line-strong bg-surface py-0 pr-7 pl-2.5 text-base text-ink outline-none',
          'disabled:cursor-not-allowed disabled:border-line disabled:bg-surface-sunken disabled:text-ink-subtle',
          className
        )}
        {...props}
      />
    )
  }
)

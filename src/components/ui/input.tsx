import { cn } from '@/lib/utils'
import { forwardRef } from 'react'
import type { InputHTMLAttributes } from 'react'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          'field-focus h-8 w-full rounded-md border border-line-strong bg-surface px-2.5 text-base text-ink outline-none',
          'placeholder:text-ink-subtle',
          'disabled:cursor-not-allowed disabled:border-line disabled:bg-surface-sunken disabled:text-ink-subtle',
          'read-only:bg-surface-sunken',
          'aria-[invalid=true]:border-danger',
          className
        )}
        {...props}
      />
    )
  }
)

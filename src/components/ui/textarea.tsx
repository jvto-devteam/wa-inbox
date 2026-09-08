import { cn } from '@/lib/utils'
import { forwardRef } from 'react'
import type { TextareaHTMLAttributes } from 'react'

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        className={cn(
          'field-focus w-full rounded-md border border-line-strong bg-surface px-2.5 py-2 text-base text-ink outline-none',
          'placeholder:text-ink-subtle',
          'disabled:cursor-not-allowed disabled:border-line disabled:bg-surface-sunken disabled:text-ink-subtle',
          'aria-[invalid=true]:border-danger',
          className
        )}
        {...props}
      />
    )
  }
)

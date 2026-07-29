import { cn } from '@/lib/utils'
import { forwardRef } from 'react'
import type { TextareaHTMLAttributes } from 'react'

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        className={cn(
          'w-full rounded-lg border border-input bg-transparent p-2.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand/20',
          className
        )}
        {...props}
      />
    )
  }
)

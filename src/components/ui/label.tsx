import { cn } from '@/lib/utils'
import type { HTMLAttributes, LabelHTMLAttributes, ReactNode } from 'react'

/**
 * Label + petunjuk + galat untuk satu field. Hari ini ketiganya ditulis ulang di setiap
 * halaman form dengan ukuran dan jarak yang berbeda-beda: /settings/business-profile punya
 * 7 label, /chatbot 6, /templates, /bot-control/test-lab dan KnowledgeEditor sisanya --
 * dan tidak ada dua yang sama persis.
 *
 * <FieldError> memakai role="alert" supaya galat validasi terbaca saat muncul, bukan hanya
 * terlihat.
 */
export function Label({
  required,
  className,
  children,
  ...props
}: LabelHTMLAttributes<HTMLLabelElement> & { required?: boolean }) {
  return (
    <label className={cn('block text-sm font-medium text-ink', className)} {...props}>
      {children}
      {required ? (
        <span className="ml-0.5 text-danger" aria-hidden="true">
          *
        </span>
      ) : null}
    </label>
  )
}

export function FieldHint({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-xs text-ink-muted', className)} {...props} />
}

export function FieldError({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p role="alert" className={cn('text-xs font-medium text-danger', className)} {...props} />
}

/** Pembungkus satu field: label, kontrol, lalu petunjuk/galat, dengan jarak yang sama. */
export function Field({
  label,
  htmlFor,
  required,
  hint,
  error,
  children,
  className,
}: {
  label: string
  htmlFor?: string
  required?: boolean
  hint?: ReactNode
  error?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={htmlFor} required={required}>
        {label}
      </Label>
      {children}
      {error ? <FieldError>{error}</FieldError> : hint ? <FieldHint>{hint}</FieldHint> : null}
    </div>
  )
}

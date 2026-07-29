'use client'
import { useEffect } from 'react'
import { cn } from '@/lib/utils'

/**
 * A generic centered dialog with a backdrop, closeable via backdrop click or Escape.
 * Deliberately unopinionated about content -- callers own the inner layout (padding,
 * max-width, etc via className) same as Card.
 */
export function Modal({
  onClose,
  className,
  children,
}: {
  onClose: () => void
  className?: string
  children: React.ReactNode
}) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div
      role="presentation"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className={cn('max-h-[85vh] w-full max-w-sm overflow-y-auto rounded-lg bg-white p-4 shadow-lg', className)}
      >
        {children}
      </div>
    </div>
  )
}

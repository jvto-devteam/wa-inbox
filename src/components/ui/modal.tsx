'use client'
import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'

/**
 * A generic centered dialog with a backdrop, closeable via backdrop click or Escape.
 * Deliberately unopinionated about content -- callers own the inner layout (padding,
 * max-width, etc via className) same as Card.
 *
 * Salah satu dari dua tempat di sistem ini yang boleh punya bayangan (--shadow-modal):
 * ini overlay sungguhan, jadi ia memang harus terangkat dari halaman di belakangnya.
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
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  // Tanpa ini fokus keyboard tertinggal di tombol yang membuka dialog: Tab berikutnya
  // menyusuri halaman di belakang backdrop, bukan isi dialognya.
  useEffect(() => {
    dialogRef.current?.focus()
  }, [])

  return (
    <div
      role="presentation"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/35 p-4"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'max-h-[85vh] w-full max-w-sm overflow-y-auto rounded-lg border border-line bg-surface p-4 shadow-modal outline-none',
          className
        )}
      >
        {children}
      </div>
    </div>
  )
}

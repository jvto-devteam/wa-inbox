'use client'
import type { ReactNode } from 'react'
import { GalleryHorizontalEnd, KeyRound, MessageSquare, Ticket, Timer } from 'lucide-react'
import { cn } from '@/lib/utils'

export type TemplateFormat = 'TEXT' | 'CAROUSEL' | 'LTO' | 'COUPON' | 'AUTH'

const TYPES: { value: TemplateFormat; icon: ReactNode; label: string; description: string }[] = [
  { value: 'TEXT', icon: <MessageSquare />, label: 'Teks', description: 'Teks + media + tombol' },
  { value: 'CAROUSEL', icon: <GalleryHorizontalEnd />, label: 'Carousel', description: '2-10 kartu geser' },
  { value: 'LTO', icon: <Timer />, label: 'Penawaran Waktu Terbatas', description: 'Promo dengan hitung mundur' },
  { value: 'COUPON', icon: <Ticket />, label: 'Kode Kupon', description: 'Kode diskon + tombol salin' },
  { value: 'AUTH', icon: <KeyRound />, label: 'Autentikasi', description: 'Kode OTP' },
]

// A clickable grid instead of a <Select> dropdown -- every option's shape/description is
// visible at once, matching waba-jvto's own type-selector.tsx.
export function TypeSelector({ value, onChange }: { value: TemplateFormat; onChange: (value: TemplateFormat) => void }) {
  return (
    <div role="radiogroup" aria-label="Format template" className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
      {TYPES.map((t) => (
        <button
          key={t.value}
          type="button"
          role="radio"
          aria-checked={value === t.value}
          onClick={() => onChange(t.value)}
          className={cn(
            'focus-ring flex flex-col items-start gap-1 rounded-md border p-2.5 text-left transition-colors',
            value === t.value
              ? 'border-accent bg-accent-subtle'
              : 'border-line bg-surface hover:bg-surface-sunken'
          )}
        >
          <span
            aria-hidden="true"
            className={cn('[&_svg]:size-4', value === t.value ? 'text-accent' : 'text-ink-subtle')}
          >
            {t.icon}
          </span>
          <span className="text-sm font-medium text-ink">{t.label}</span>
          <span className="text-xs text-ink-muted">{t.description}</span>
        </button>
      ))}
    </div>
  )
}

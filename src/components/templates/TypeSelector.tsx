'use client'
import { cn } from '@/lib/utils'

export type TemplateFormat = 'TEXT' | 'CAROUSEL' | 'LTO' | 'COUPON' | 'AUTH'

const TYPES: { value: TemplateFormat; icon: string; label: string; description: string }[] = [
  { value: 'TEXT', icon: '💬', label: 'Teks', description: 'Teks + media + tombol' },
  { value: 'CAROUSEL', icon: '🎠', label: 'Carousel', description: '2-10 kartu geser' },
  { value: 'LTO', icon: '⏳', label: 'Penawaran Waktu Terbatas', description: 'Promo dengan hitung mundur' },
  { value: 'COUPON', icon: '🎟️', label: 'Kode Kupon', description: 'Kode diskon + tombol salin' },
  { value: 'AUTH', icon: '🔐', label: 'Autentikasi', description: 'Kode OTP' },
]

// A clickable card grid instead of a <Select> dropdown -- every option's shape/description is
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
            'flex flex-col items-start gap-1 rounded-lg border p-2.5 text-left transition-colors',
            value === t.value ? 'border-brand bg-brand/5' : 'border-border hover:bg-muted/50'
          )}
        >
          <span className="text-lg" aria-hidden="true">
            {t.icon}
          </span>
          <span className="text-sm font-medium text-navy">{t.label}</span>
          <span className="text-[11px] text-muted-foreground">{t.description}</span>
        </button>
      ))}
    </div>
  )
}

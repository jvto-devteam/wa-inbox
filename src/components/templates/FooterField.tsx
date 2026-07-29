'use client'
import { Input } from '@/components/ui/input'

// Meta forbids variables in the footer, so this is a plain fixed string -- no BodyField-style
// "+ Variabel" button here.
export function FooterField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <Input
      aria-label="Footer"
      placeholder="Footer (opsional, maks. 60 karakter, tanpa variabel)"
      maxLength={60}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

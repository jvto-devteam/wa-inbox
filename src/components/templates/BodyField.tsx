'use client'
import { useRef } from 'react'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'

/**
 * The body textarea for every template type (OFFICIAL and QUICK_REPLY alike) plus its one
 * "+ Variabel" button -- the only way a variable is ever created. No separate naming step:
 * clicking it counts the {{n}} placeholders already in the body, inserts the next one at the
 * cursor position (not appended to the end), and restores focus/cursor right after it. This
 * mirrors waba-jvto's own body-field.tsx exactly, since typing "{{1}}" by hand invites typos
 * and out-of-order numbering.
 */
export function BodyField({
  value,
  onChange,
  label = 'Isi pesan',
  placeholder,
  maxLength = 1024,
  rows = 3,
}: {
  value: string
  onChange: (value: string) => void
  label?: string
  placeholder?: string
  maxLength?: number
  rows?: number
}) {
  const ref = useRef<HTMLTextAreaElement>(null)

  function insertVariable() {
    const el = ref.current
    if (!el) return
    const count = (value.match(/\{\{\d+\}\}/g) ?? []).length + 1
    const variable = `{{${count}}}`
    const start = el.selectionStart
    const end = el.selectionEnd
    const newValue = value.slice(0, start) + variable + value.slice(end)
    onChange(newValue)
    requestAnimationFrame(() => {
      el.selectionStart = start + variable.length
      el.selectionEnd = start + variable.length
      el.focus()
    })
  }

  return (
    <div className="space-y-1.5">
      <Textarea
        ref={ref}
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        maxLength={maxLength}
      />
      <div className="flex items-center justify-between">
        <Button type="button" variant="outline" size="sm" onClick={insertVariable}>
          + Variabel
        </Button>
        <span className="text-xs text-muted-foreground">
          {value.length}/{maxLength}
        </span>
      </div>
    </div>
  )
}

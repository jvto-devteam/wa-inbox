'use client'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'

export type ButtonType = 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER'
export type ButtonDraft = { type: ButtonType; text: string; url: string; phoneNumber: string }
export const EMPTY_BUTTON_DRAFT: ButtonDraft = { type: 'QUICK_REPLY', text: '', url: '', phoneNumber: '' }

/**
 * A reusable add/edit/delete list of template buttons -- the same shape used for a plain
 * TEXT/AUTH template's top-level buttons, an LTO's optional buttons, and each CAROUSEL card's
 * own buttons. `labelSuffix` disambiguates aria-labels when several instances render on one
 * page at once (e.g. " kartu 1" per carousel card); leave it empty for a single top-level list.
 */
export function ButtonsField({
  buttons,
  onChange,
  max = 3,
  labelSuffix = '',
}: {
  buttons: ButtonDraft[]
  onChange: (buttons: ButtonDraft[]) => void
  max?: number
  labelSuffix?: string
}) {
  function update(i: number, patch: Partial<ButtonDraft>) {
    onChange(buttons.map((b, idx) => (idx === i ? { ...b, ...patch } : b)))
  }
  function remove(i: number) {
    onChange(buttons.filter((_, idx) => idx !== i))
  }
  function add() {
    if (buttons.length >= max) return
    onChange([...buttons, EMPTY_BUTTON_DRAFT])
  }

  return (
    <div className="space-y-1.5">
      {buttons.map((btn, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <Select
            aria-label={`Tipe tombol ${i + 1}${labelSuffix}`}
            value={btn.type}
            onChange={(e) => update(i, { type: e.target.value as ButtonType })}
            className="w-auto"
          >
            <option value="QUICK_REPLY">Balasan Cepat</option>
            <option value="URL">Tautan URL</option>
            <option value="PHONE_NUMBER">Nomor Telepon</option>
          </Select>
          <Input
            aria-label={`Label tombol ${i + 1}${labelSuffix}`}
            placeholder="Label tombol"
            value={btn.text}
            onChange={(e) => update(i, { text: e.target.value })}
          />
          {btn.type === 'URL' && (
            <Input
              aria-label={`URL tombol ${i + 1}${labelSuffix}`}
              placeholder="https://..."
              value={btn.url}
              onChange={(e) => update(i, { url: e.target.value })}
            />
          )}
          {btn.type === 'PHONE_NUMBER' && (
            <Input
              aria-label={`Nomor tombol ${i + 1}${labelSuffix}`}
              placeholder="+62..."
              value={btn.phoneNumber}
              onChange={(e) => update(i, { phoneNumber: e.target.value })}
            />
          )}
          <button
            type="button"
            aria-label={`Hapus tombol ${i + 1}${labelSuffix}`}
            onClick={() => remove(i)}
            className="shrink-0 text-muted-foreground hover:text-destructive"
          >
            ✕
          </button>
        </div>
      ))}
      {buttons.length < max && (
        <Button type="button" variant="outline" size="sm" onClick={add}>
          + Tombol
        </Button>
      )}
    </div>
  )
}

export function buttonDraftIsValid(b: ButtonDraft): boolean {
  if (!b.text.trim()) return false
  if (b.type === 'URL') return b.url.trim() !== ''
  if (b.type === 'PHONE_NUMBER') return b.phoneNumber.trim() !== ''
  return true
}

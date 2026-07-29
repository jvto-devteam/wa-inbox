'use client'
import { Select } from '@/components/ui/select'
import { Input } from '@/components/ui/input'

// Mirrors Template.header (see prisma/schema.prisma) and the API's headerSchema
// (src/app/api/templates/route.ts) exactly -- NONE is a real, distinct selection (no header
// at all), not just an absent field, so the picker always shows a definite choice.
export type HeaderDraft =
  | { type: 'NONE' }
  | { type: 'TEXT'; text: string }
  | { type: 'IMAGE'; mediaUrl: string }
  | { type: 'VIDEO'; mediaUrl: string }
  | { type: 'DOCUMENT'; mediaUrl: string }

export const EMPTY_HEADER: HeaderDraft = { type: 'NONE' }

const HEADER_TYPE_LABEL: Record<HeaderDraft['type'], string> = {
  NONE: 'Tanpa Header',
  TEXT: 'Teks',
  IMAGE: 'URL Gambar',
  VIDEO: 'URL Video',
  DOCUMENT: 'URL Dokumen',
}

function emptyDraftFor(type: HeaderDraft['type']): HeaderDraft {
  if (type === 'NONE') return { type }
  if (type === 'TEXT') return { type, text: '' }
  return { type, mediaUrl: '' }
}

export function HeaderField({ value, onChange }: { value: HeaderDraft; onChange: (value: HeaderDraft) => void }) {
  return (
    <div className="space-y-1.5">
      <Select
        aria-label="Tipe header"
        value={value.type}
        onChange={(e) => onChange(emptyDraftFor(e.target.value as HeaderDraft['type']))}
        className="w-auto"
      >
        {(Object.keys(HEADER_TYPE_LABEL) as HeaderDraft['type'][]).map((t) => (
          <option key={t} value={t}>
            {HEADER_TYPE_LABEL[t]}
          </option>
        ))}
      </Select>
      {value.type === 'TEXT' && (
        <Input
          aria-label="Teks header"
          placeholder="Teks header (maks. 60 karakter)"
          maxLength={60}
          value={value.text}
          onChange={(e) => onChange({ type: 'TEXT', text: e.target.value })}
        />
      )}
      {(value.type === 'IMAGE' || value.type === 'VIDEO' || value.type === 'DOCUMENT') && (
        <Input
          aria-label="URL media header"
          placeholder="URL gambar/video/dokumen (https://...)"
          value={value.mediaUrl}
          onChange={(e) => onChange({ ...value, mediaUrl: e.target.value })}
        />
      )}
    </div>
  )
}

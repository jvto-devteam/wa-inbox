'use client'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Select } from '@/components/ui/select'

export type LabelOption = { id: string; name: string; color: string }

export function LabelPicker({
  conversationId,
  allLabels,
  attachedLabels,
  onAttachedChange,
}: {
  conversationId: string
  allLabels: LabelOption[]
  attachedLabels: LabelOption[]
  onAttachedChange: (labels: LabelOption[]) => void
}) {
  const [error, setError] = useState<string | null>(null)
  const availableLabels = allLabels.filter((l) => !attachedLabels.some((a) => a.id === l.id))

  // Labels drive triage decisions, so the UI must only ever show what the server confirmed —
  // no optimistic update here. Await the response, and only call onAttachedChange on success;
  // otherwise the pill state can silently drift from the database with no recovery path.
  async function attach(labelId: string) {
    const label = allLabels.find((l) => l.id === labelId)
    if (!label) return
    setError(null)
    try {
      const res = await fetch(`/api/conversations/${conversationId}/labels`, {
        method: 'POST',
        body: JSON.stringify({ labelId }),
      })
      if (!res.ok) {
        setError(`Gagal menambahkan label "${label.name}"`)
        return
      }
      onAttachedChange([...attachedLabels, label])
    } catch {
      setError(`Gagal menambahkan label "${label.name}"`)
    }
  }

  async function detach(labelId: string) {
    const label = attachedLabels.find((l) => l.id === labelId)
    setError(null)
    try {
      const res = await fetch(`/api/conversations/${conversationId}/labels`, {
        method: 'DELETE',
        body: JSON.stringify({ labelId }),
      })
      if (!res.ok) {
        setError(`Gagal menghapus label "${label?.name ?? labelId}"`)
        return
      }
      onAttachedChange(attachedLabels.filter((l) => l.id !== labelId))
    } catch {
      setError(`Gagal menghapus label "${label?.name ?? labelId}"`)
    }
  }

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Label</h3>
      <div className="flex flex-wrap gap-1.5">
        {attachedLabels.map((l) => (
          <Badge key={l.id} style={{ backgroundColor: l.color + '22', color: l.color }} className="gap-1">
            {l.name}
            <button
              type="button"
              aria-label={`Hapus label ${l.name}`}
              onClick={() => detach(l.id)}
              className="ml-0.5 leading-none"
            >
              ×
            </button>
          </Badge>
        ))}
      </div>
      {availableLabels.length > 0 && (
        <Select
          aria-label="Tambah label"
          value=""
          onChange={(e) => {
            if (e.target.value) attach(e.target.value)
          }}
          className="w-auto"
        >
          <option value="">+ Tambah label</option>
          {availableLabels.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </Select>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

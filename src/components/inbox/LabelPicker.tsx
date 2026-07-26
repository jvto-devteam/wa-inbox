'use client'
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
  const availableLabels = allLabels.filter((l) => !attachedLabels.some((a) => a.id === l.id))

  async function attach(labelId: string) {
    const label = allLabels.find((l) => l.id === labelId)
    if (!label) return
    onAttachedChange([...attachedLabels, label])
    await fetch(`/api/conversations/${conversationId}/labels`, {
      method: 'POST',
      body: JSON.stringify({ labelId }),
    })
  }

  async function detach(labelId: string) {
    onAttachedChange(attachedLabels.filter((l) => l.id !== labelId))
    await fetch(`/api/conversations/${conversationId}/labels`, {
      method: 'DELETE',
      body: JSON.stringify({ labelId }),
    })
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
    </div>
  )
}

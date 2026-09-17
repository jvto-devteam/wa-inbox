'use client'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { PanelSectionTitle } from './ContactPanel'

export type LabelOption = { id: string; name: string; color: string }

const NEW_LABEL_VALUE = '__new__'
const DEFAULT_NEW_LABEL_COLOR = '#3C6B42'

export function LabelPicker({
  conversationId,
  allLabels,
  attachedLabels,
  onAttachedChange,
  onAllLabelsChange,
}: {
  conversationId: string
  allLabels: LabelOption[]
  attachedLabels: LabelOption[]
  onAttachedChange: (labels: LabelOption[]) => void
  // `Label` is a system-wide table, not per-conversation -- creating one here has to update
  // the caller's copy too, or the next conversation opened would still think it doesn't exist.
  onAllLabelsChange: (labels: LabelOption[]) => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(DEFAULT_NEW_LABEL_COLOR)
  const [creatingBusy, setCreatingBusy] = useState(false)
  const availableLabels = allLabels.filter((l) => !attachedLabels.some((a) => a.id === l.id))

  // Labels drive triage decisions, so the UI must only ever show what the server confirmed —
  // no optimistic update here. Await the response, and only call onAttachedChange on success;
  // otherwise the pill state can silently drift from the database with no recovery path.
  async function attachLabel(label: LabelOption) {
    setError(null)
    try {
      const res = await fetch(`/api/conversations/${conversationId}/labels`, {
        method: 'POST',
        body: JSON.stringify({ labelId: label.id }),
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

  async function attach(labelId: string) {
    const label = allLabels.find((l) => l.id === labelId)
    if (!label) return
    await attachLabel(label)
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

  // Creates a brand-new row in the system-wide Label table, then attaches it to this
  // conversation right away -- an operator reaching for "+ Buat label baru" always wants it on
  // the chat they're looking at, not just sitting unused in the table.
  async function createLabel() {
    const name = newName.trim()
    if (!name) return
    setError(null)
    setCreatingBusy(true)
    try {
      const res = await fetch('/api/labels', { method: 'POST', body: JSON.stringify({ name, color: newColor }) })
      if (!res.ok) {
        setError(`Gagal membuat label "${name}"`)
        return
      }
      const created: LabelOption = await res.json()
      onAllLabelsChange([...allLabels, created])
      await attachLabel(created)
      setCreating(false)
      setNewName('')
      setNewColor(DEFAULT_NEW_LABEL_COLOR)
    } catch {
      setError(`Gagal membuat label "${name}"`)
    } finally {
      setCreatingBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      <PanelSectionTitle>Label</PanelSectionTitle>
      <div className="flex flex-wrap gap-1.5 empty:hidden">
        {attachedLabels.map((l) => (
          <Badge key={l.id} style={{ backgroundColor: l.color + '22', color: l.color }} className="gap-1">
            {l.name}
            <button
              type="button"
              aria-label={`Hapus label ${l.name}`}
              onClick={() => detach(l.id)}
              className="focus-ring -mr-0.5 ml-0.5 rounded-xs leading-none opacity-70 hover:opacity-100"
            >
              ×
            </button>
          </Badge>
        ))}
      </div>
      {!creating ? (
        // Always rendered, even with zero availableLabels -- "+ Buat label baru" is the only
        // door into the Label table (POST /api/labels has no other caller in the UI), so it
        // must stay reachable even on a completely fresh install with no labels at all.
        <Select
          aria-label="Tambah label"
          value=""
          onChange={(e) => {
            if (e.target.value === NEW_LABEL_VALUE) {
              setCreating(true)
              return
            }
            if (e.target.value) attach(e.target.value)
          }}
          className="w-full"
        >
          <option value="">+ Tambah label</option>
          {availableLabels.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
          <option value={NEW_LABEL_VALUE}>+ Buat label baru...</option>
        </Select>
      ) : (
        <div className="flex items-center gap-2">
          <Input
            type="color"
            aria-label="Warna label baru"
            value={newColor}
            onChange={(e) => setNewColor(e.target.value)}
            className="h-8 w-9 shrink-0 cursor-pointer p-0.5"
          />
          <Input
            aria-label="Nama label baru"
            placeholder="Nama label"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="flex-1"
            autoFocus
          />
          <Button type="button" size="sm" onClick={createLabel} disabled={!newName.trim() || creatingBusy}>
            Simpan
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setCreating(false)
              setNewName('')
            }}
          >
            Batal
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  )
}

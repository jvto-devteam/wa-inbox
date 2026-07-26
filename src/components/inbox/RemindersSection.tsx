'use client'
import { useEffect, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

export type Reminder = { id: string; dueAt: string; note: string; done: boolean }

function formatDueDate(iso: string) {
  return new Date(iso).toLocaleDateString('id-ID', { dateStyle: 'medium' })
}

export function RemindersSection({ contactId }: { contactId: string }) {
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [dueDate, setDueDate] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    fetch(`/api/contacts/${contactId}/reminders`)
      .then((r) => r.json())
      .then(setReminders)
  }, [contactId])

  // Same rule as NotesSection/LabelPicker: only ever show what the server confirmed, no
  // optimistic update. Await the response and only update state on success.
  async function addReminder() {
    const trimmed = note.trim()
    if (!trimmed || !dueDate) return
    setError(null)
    setSubmitting(true)
    try {
      const res = await fetch(`/api/contacts/${contactId}/reminders`, {
        method: 'POST',
        body: JSON.stringify({ dueAt: new Date(dueDate).toISOString(), note: trimmed }),
      })
      if (!res.ok) {
        setError('Gagal menambahkan reminder')
        return
      }
      const reminder = (await res.json()) as Reminder
      setReminders((prev) => [...prev, reminder].sort((a, b) => a.dueAt.localeCompare(b.dueAt)))
      setNote('')
      setDueDate('')
    } catch {
      setError('Gagal menambahkan reminder')
    } finally {
      setSubmitting(false)
    }
  }

  async function toggleDone(reminder: Reminder) {
    setError(null)
    try {
      const res = await fetch(`/api/contacts/${contactId}/reminders`, {
        method: 'PATCH',
        body: JSON.stringify({ reminderId: reminder.id, done: !reminder.done }),
      })
      if (!res.ok) {
        setError('Gagal memperbarui reminder')
        return
      }
      const updated = (await res.json()) as Reminder
      setReminders((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))
    } catch {
      setError('Gagal memperbarui reminder')
    }
  }

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Reminder</h3>
      <Card className="space-y-2 p-3">
        {reminders.length === 0 ? (
          <p className="text-sm text-muted-foreground">Belum ada reminder.</p>
        ) : (
          <ul className="space-y-2">
            {reminders.map((r) => (
              <li key={r.id} className="flex items-start gap-2 border-b border-border pb-2 last:border-0 last:pb-0">
                <input
                  type="checkbox"
                  aria-label={r.done ? `Tandai "${r.note}" belum selesai` : `Tandai "${r.note}" selesai`}
                  checked={r.done}
                  onChange={() => toggleDone(r)}
                  className="mt-1 size-3.5 accent-brand"
                />
                <div className="flex-1 space-y-0.5">
                  <p className={r.done ? 'text-sm text-muted-foreground line-through' : 'text-sm text-navy'}>{r.note}</p>
                  <p className="text-xs text-muted-foreground">{formatDueDate(r.dueAt)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <div className="space-y-2">
        <Input
          type="date"
          aria-label="Tanggal jatuh tempo"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
        />
        <Input
          type="text"
          aria-label="Catatan reminder"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Contoh: follow up pembayaran DP"
        />
        <Button type="button" onClick={addReminder} disabled={!note.trim() || !dueDate || submitting}>
          Tambah Reminder
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

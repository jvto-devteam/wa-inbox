'use client'
import { useEffect, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { fetchJson } from '@/lib/fetch-json'

export type Note = { id: string; body: string; authorName: string | null; createdAt: string }

function formatNoteDate(iso: string) {
  return new Date(iso).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })
}

export function NotesSection({ contactId }: { contactId: string }) {
  const [notes, setNotes] = useState<Note[]>([])
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    fetchJson<Note[]>(`/api/contacts/${contactId}/notes`)
      .then(setNotes)
      .catch(() => setError('Gagal memuat catatan'))
  }, [contactId])

  // Notes are a record of what agents told each other about a customer, so the list must only
  // ever show what the server confirmed — no optimistic update here (same rule Task 35 applied
  // to labels). Await the response, and only prepend to state on success.
  async function addNote() {
    const body = draft.trim()
    if (!body) return
    setError(null)
    setSubmitting(true)
    try {
      const res = await fetch(`/api/contacts/${contactId}/notes`, {
        method: 'POST',
        body: JSON.stringify({ body }),
      })
      if (!res.ok) {
        setError('Gagal menambahkan catatan')
        return
      }
      const note = (await res.json()) as Note
      setNotes((prev) => [note, ...prev])
      setDraft('')
    } catch {
      setError('Gagal menambahkan catatan')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Catatan</h3>
      <Card className="space-y-2 p-3">
        {notes.length === 0 ? (
          <p className="text-sm text-muted-foreground">Belum ada catatan.</p>
        ) : (
          <ul className="space-y-2">
            {notes.map((n) => (
              <li key={n.id} className="space-y-0.5 border-b border-border pb-2 last:border-0 last:pb-0">
                <p className="text-sm text-navy">{n.body}</p>
                <p className="text-xs text-muted-foreground">
                  {n.authorName ?? 'Agen'} &middot; {formatNoteDate(n.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Textarea
        aria-label="Catatan baru"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Tulis catatan tentang kontak ini..."
        rows={2}
      />
      <Button type="button" onClick={addNote} disabled={!draft.trim() || submitting}>
        Tambah Catatan
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

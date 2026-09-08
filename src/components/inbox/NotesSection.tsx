'use client'
import { useEffect, useState } from 'react'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { PanelSectionTitle } from './ContactPanel'
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
    // Daftar dengan garis rambut, bukan kartu di dalam panel yang sudah menjadi kartu.
    <div className="space-y-2">
      <PanelSectionTitle>Catatan</PanelSectionTitle>
      {notes.length === 0 ? (
        <p className="text-sm text-ink-muted">Belum ada catatan.</p>
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {notes.map((n) => (
            <li key={n.id} className="space-y-0.5 py-2">
              <p className="text-sm break-words text-ink">{n.body}</p>
              <p className="text-xs text-ink-subtle">
                {n.authorName ?? 'Agen'} &middot; {formatNoteDate(n.createdAt)}
              </p>
            </li>
          ))}
        </ul>
      )}
      <Textarea
        aria-label="Catatan baru"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Tulis catatan tentang kontak ini..."
        rows={2}
      />
      <Button type="button" variant="outline" onClick={addNote} disabled={!draft.trim() || submitting}>
        Tambah Catatan
      </Button>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  )
}

'use client'
import { useCallback, useEffect, useState } from 'react'
import { SkeletonText } from '@/components/ui/skeleton'
import { fetchJson } from '@/lib/fetch-json'
import { CREW_NOTE_SECTIONS, CREW_NOTE_SECTION_LABEL, type CrewNote, type CrewNoteSection } from '@/lib/daily-summary/payload-schema'
import { wibDateTimeLabel } from '@/lib/summary-items/status'
import { PanelSectionTitle } from './ContactPanel'
// Hanya tipe: route itu menyentuh prisma, dan komponen klien tidak boleh membawa modul server.
import type { ChatReviewResponse } from '@/app/api/conversations/[id]/chat-review/route'

/**
 * "Catatan untuk crew" di tab Kontak panel kanan Inbox, tepat di bawah data booking (Guest Brief, owner 2026-11-06).
 *
 * Isinya SATU sumber dengan yang dibaca crew di aplikasi crew: `chatReview.catatanCrew`, dibuat sesudah ringkasan chat
 * (`chat-review/crew-note.ts`). Ikut hidup: ringkasan baru dari auto-refresh datang sebagai `conversation.updated`
 * lewat SSE yang sama dengan tab Ringkasan chat, lalu catatan dimuat ulang. Tidak ada tombol kirim: tampilan ini hanya
 * agar admin bisa melihat apa yang akan dibaca crew.
 *
 * Tidak tampil sama sekali bila percakapan tidak punya booking, atau belum ada catatan (fitur mati / belum diproses).
 */

/** Bagian yang diberi penekanan: crew sebaiknya membaca ini dulu. */
const EMPHASIZED: ReadonlySet<CrewNoteSection> = new Set<CrewNoteSection>(['perubahan', 'jangan'])

export function CrewNoteBody({ note }: { note: CrewNote }) {
  const filled = CREW_NOTE_SECTIONS.filter((s) => note[s].length > 0)
  if (filled.length === 0) {
    return <p className="text-sm text-ink-muted">Belum ada hal dari chat ini yang perlu diketahui crew.</p>
  }
  return (
    <div className="space-y-2">
      {filled.map((section) => (
        <div key={section} className="space-y-0.5">
          <p className={EMPHASIZED.has(section) ? 'text-xs font-semibold text-warning' : 'text-xs font-semibold text-ink-subtle'}>
            {EMPHASIZED.has(section) ? '⚠ ' : ''}
            {CREW_NOTE_SECTION_LABEL[section]}
          </p>
          <ul className="list-disc space-y-0.5 pl-4 text-sm break-words text-ink">
            {note[section].map((line, i) => (
              <li key={`${section}-${i}`}>{line}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

export function CrewNoteSection({ conversationId, hasBooking }: { conversationId: string; hasBooking: boolean }) {
  const [note, setNote] = useState<CrewNote | null | undefined>(undefined) // undefined = memuat, null = tidak ada
  const url = `/api/conversations/${encodeURIComponent(conversationId)}/chat-review`

  const load = useCallback(async () => {
    try {
      const body = await fetchJson<ChatReviewResponse>(url)
      setNote(body.latest?.review.catatanCrew ?? null)
    } catch {
      // Gagal memuat = bagian ini tidak tampil; tab Ringkasan chat tetap menjelaskan galatnya.
      setNote((prev) => (prev === undefined ? null : prev))
    }
  }, [url])

  useEffect(() => {
    if (!hasBooking) return
    let active = true
    fetchJson<ChatReviewResponse>(url)
      .then((body) => {
        if (active) setNote(body.latest?.review.catatanCrew ?? null)
      })
      .catch(() => {
        if (active) setNote((prev) => (prev === undefined ? null : prev))
      })
    return () => {
      active = false
    }
  }, [hasBooking, url])

  // Ringkasan baru dari auto-refresh datang sebagai `conversation.updated` (jalur SSE yang sama dengan ChatReviewTab).
  useEffect(() => {
    if (!hasBooking || typeof EventSource === 'undefined') return
    const es = new EventSource('/api/sse')
    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as { type?: string; conversationId?: string }
        if (event.conversationId === conversationId && event.type === 'conversation.updated') void load()
      } catch {
        // Event rusak diabaikan.
      }
    }
    return () => es.close()
  }, [hasBooking, conversationId, load])

  if (!hasBooking) return null
  if (note === undefined) {
    return (
      <section aria-label="Catatan untuk crew" aria-busy="true" className="space-y-2">
        <PanelSectionTitle>Catatan untuk crew</PanelSectionTitle>
        <SkeletonText lines={3} />
      </section>
    )
  }
  if (note === null) return null

  return (
    <section aria-label="Catatan untuk crew" className="space-y-2">
      <PanelSectionTitle>Catatan untuk crew</PanelSectionTitle>
      <CrewNoteBody note={note} />
      <p className="text-xs text-ink-subtle">Diperbarui {wibDateTimeLabel(note.diperbaruiAt)} · dibaca crew di aplikasi crew</p>
    </section>
  )
}

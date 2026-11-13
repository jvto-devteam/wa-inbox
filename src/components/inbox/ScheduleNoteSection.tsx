'use client'
import { useCallback, useEffect, useState } from 'react'
import { SkeletonText } from '@/components/ui/skeleton'
import { fetchJson } from '@/lib/fetch-json'
import { wibDateTimeLabel } from '@/lib/summary-items/status'
import { PanelSectionTitle } from './ContactPanel'
// Hanya tipe: route itu menyentuh prisma, dan komponen klien tidak boleh membawa modul server.
import type { ChatReviewResponse } from '@/app/api/conversations/[id]/chat-review/route'
import type { ScheduleNote } from '@/lib/daily-summary/payload-schema'

/**
 * "Note untuk Schedule" di tab Kontak panel kanan Inbox, tepat di bawah data booking (owner 2026-11-12).
 *
 * Isinya hal dari chat tamu yang belum punya tempat di Schedule (diet, perayaan, permintaan aktivitas, rencana rute),
 * disusun `chat-review/schedule-note.ts` sesudah ringkasan chat dan sengaja TIDAK mengulang jemput/antar, hotel,
 * tanggal, pax, atau kaos. Hanya tampilan: belum dikirim ke Schedule. Ikut terbaru lewat SSE yang sama dengan
 * "Catatan untuk crew". Tidak tampil bila percakapan tanpa booking atau tidak ada yang layak.
 */
export function ScheduleNoteSection({ conversationId, hasBooking }: { conversationId: string; hasBooking: boolean }) {
  const [note, setNote] = useState<ScheduleNote | null | undefined>(undefined) // undefined = memuat, null = tidak ada
  const url = `/api/conversations/${encodeURIComponent(conversationId)}/chat-review`

  const load = useCallback(async () => {
    try {
      const body = await fetchJson<ChatReviewResponse>(url)
      setNote(body.scheduleNote ?? null)
    } catch {
      setNote((prev) => (prev === undefined ? null : prev))
    }
  }, [url])

  useEffect(() => {
    if (!hasBooking) return
    let active = true
    fetchJson<ChatReviewResponse>(url)
      .then((body) => {
        if (active) setNote(body.scheduleNote ?? null)
      })
      .catch(() => {
        if (active) setNote((prev) => (prev === undefined ? null : prev))
      })
    return () => {
      active = false
    }
  }, [hasBooking, url])

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
      <section aria-label="Note untuk Schedule" aria-busy="true" className="space-y-2">
        <PanelSectionTitle>Note untuk Schedule</PanelSectionTitle>
        <SkeletonText lines={2} />
      </section>
    )
  }
  if (note === null) return null

  return (
    <section aria-label="Note untuk Schedule" className="space-y-2">
      <PanelSectionTitle>Note untuk Schedule</PanelSectionTitle>
      <ul className="list-disc space-y-0.5 pl-4 text-sm break-words text-ink">
        {note.baris.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
      <p className="text-xs text-ink-subtle">Dari chat · {wibDateTimeLabel(note.diperbaruiAt)} · belum dikirim ke Schedule</p>
    </section>
  )
}

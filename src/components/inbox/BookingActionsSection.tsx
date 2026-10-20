'use client'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PanelSectionTitle } from './ContactPanel'
import { BookingHistoryList } from './BookingHistoryList'
import { fetchJson } from '@/lib/fetch-json'
import { announceSummaryItemsChanged } from '@/lib/summary-items/events'
import {
  fieldLabel,
  valueText,
  type BookingActionsResponse,
  type BookingActionView,
  type BookingImpactView,
} from '@/lib/booking-actions/view'

/**
 * Kartu "Permintaan perubahan booking" di panel kanan Inbox. Satu kolom, tombol min-h-11 (44 px).
 * Tidak ada yang mengubah backoffice dari sini: "Setujui" nonaktif selama `writeEnabled` false
 * (nilai datang dari server, tidak di-hardcode di komponen); Tolak/Selesai hanya menutup kartu.
 */

type Op = 'reject' | 'dismiss' | 'done' | 'not_needed'
const BTN = 'min-h-11 whitespace-normal'

function sourceHref(conversationId: string, messageId: string | null): string {
  const q = new URLSearchParams({ conversation: conversationId })
  if (messageId) q.set('message', messageId)
  return `/inbox?${q.toString()}`
}

function ImpactLines({ impact }: { impact: BookingImpactView }) {
  if (impact.unavailable) return <p className="text-sm text-warning">Dampak tidak bisa dihitung</p>
  const lines: string[] = []
  if (impact.crewClashes.length > 0) lines.push(`Bentrok crew: ${impact.crewClashes.join(', ')}`)
  if (impact.hotelNights.length > 0) lines.push(`Malam hotel: ${impact.hotelNights.join(', ')}`)
  if (impact.medicalCheckupDate) {
    lines.push(`Medical checkup: ${valueText(impact.medicalCheckupDate.from)} → ${valueText(impact.medicalCheckupDate.to)}`)
  }
  if (lines.length === 0) return <p className="text-sm text-ink-muted">Tidak ada dampak terdeteksi.</p>
  return (
    <ul className="space-y-0.5 text-sm text-ink">
      {lines.map((l) => (
        <li key={l}>{l}</li>
      ))}
    </ul>
  )
}

function ActionCard({
  action,
  booking,
  writeEnabled,
  busy,
  onOp,
}: {
  action: BookingActionView
  booking: BookingActionsResponse['booking']
  writeEnabled: boolean
  busy: boolean
  onOp: (id: string, op: Op) => void
}) {
  const label = fieldLabel(action.field)
  const proposed = valueText(action.proposedValue)
  const old = valueText(action.oldValue)
  return (
    <li className="space-y-2 rounded-md border border-line bg-surface p-3 break-words" aria-label={`${action.type}: ${label}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={action.type === 'CHANGE' ? 'warning' : action.type === 'TASK' ? 'brand' : 'muted'}>
          {action.type === 'CHANGE' ? 'Perubahan' : action.type === 'TASK' ? 'Tugas' : 'Tidak sesuai'}
        </Badge>
      </div>
      {booking && (
        <p className="text-xs text-ink-muted">
          {booking.code ?? `#${booking.id}`}
          {booking.start && ` · ${booking.start}${booking.end ? ` – ${booking.end}` : ''}`}
        </p>
      )}

      {action.type === 'CHANGE' && (
        <>
          <p className="text-sm text-ink">
            {label}: {old} → <span className="font-medium">{proposed}</span>
          </p>
          {action.field === 'tshirt_sizes' && <p className="text-sm text-ink-muted">Vendor kaos akan diberi tahu.</p>}
          {action.tier === 'BALI' && <p className="text-sm text-ink-muted">Vendor transport Bali akan diberi tahu.</p>}
        </>
      )}
      {action.type === 'MISMATCH' && (
        <p className="text-sm text-ink">
          {label} - Chat: {proposed}
          {action.field === 'total_pax' && ' orang'} · Booking: {old}
        </p>
      )}
      {action.type === 'TASK' && (
        <>
          <p className="text-sm text-ink">
            {label}: {old} → <span className="font-medium">{proposed}</span>
          </p>
          {action.impact && <ImpactLines impact={action.impact} />}
          <p className="text-sm text-ink-muted">Ubah di backoffice. Kartu tertutup sendiri.</p>
        </>
      )}

      {action.sourceMessageId && (
        <Link
          href={sourceHref(action.conversationId, action.sourceMessageId)}
          className="focus-ring inline-block text-sm text-accent hover:underline"
        >
          Lihat pesan sumber
        </Link>
      )}

      <div className="flex flex-col gap-2">
        {action.type === 'CHANGE' && (
          <>
            <Button type="button" className={BTN} disabled={!writeEnabled || busy}>
              Setujui
            </Button>
            {!writeEnabled && (
              <p className="text-xs text-ink-muted">Aktif setelah sambungan ke my-booking tersedia</p>
            )}
            <Button type="button" variant="outline" className={BTN} disabled={busy} onClick={() => onOp(action.id, 'reject')}>
              Tolak
            </Button>
          </>
        )}
        {action.type === 'MISMATCH' && (
          <Button type="button" variant="outline" className={BTN} disabled={busy} onClick={() => onOp(action.id, 'dismiss')}>
            Chat yang salah
          </Button>
        )}
        {action.type === 'TASK' && (
          <>
            <Button type="button" className={BTN} disabled={busy} onClick={() => onOp(action.id, 'done')}>
              Selesai
            </Button>
            <Button type="button" variant="outline" className={BTN} disabled={busy} onClick={() => onOp(action.id, 'not_needed')}>
              Tidak perlu
            </Button>
          </>
        )}
      </div>
    </li>
  )
}

export function BookingActionsSection({ conversationId }: { conversationId: string }) {
  const [data, setData] = useState<BookingActionsResponse | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    return fetchJson<BookingActionsResponse>(`/api/conversations/${conversationId}/booking-actions`)
      .then((res) => {
        // Bentuk tak terduga (mis. galat bersambung) tidak boleh merobohkan panel.
        if (res && Array.isArray(res.actions) && Array.isArray(res.history)) setData(res)
      })
      .catch(() => {})
  }, [conversationId])

  useEffect(() => {
    void load()
  }, [load])

  // Jalur SSE yang sama dengan ConversationList/NotificationListener. Tanpa EventSource (jsdom,
  // peramban lama) panel tetap jalan, hanya tidak hidup.
  useEffect(() => {
    if (typeof EventSource === 'undefined') return
    const es = new EventSource('/api/sse')
    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as { type?: string; conversationId?: string }
        if (event.type === 'booking-actions.changed' && event.conversationId === conversationId) void load()
      } catch {
        // Event rusak diabaikan.
      }
    }
    return () => es.close()
  }, [conversationId, load])

  async function onOp(id: string, op: Op) {
    setBusyId(id)
    setError(null)
    try {
      await fetchJson<unknown>(`/api/booking-actions/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ op }),
      })
      announceSummaryItemsChanged()
      await load()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Permintaan gagal')
      await load()
    } finally {
      setBusyId(null)
    }
  }

  if (!data || (data.actions.length === 0 && data.history.length === 0)) return null

  return (
    <section aria-label="Tindakan booking" className="space-y-2">
      <PanelSectionTitle>Permintaan perubahan booking</PanelSectionTitle>
      {data.actions.length > 0 && (
        <ul className="flex flex-col gap-2">
          {data.actions.map((a) => (
            <ActionCard
              key={a.id}
              action={a}
              booking={data.booking}
              writeEnabled={data.writeEnabled}
              busy={busyId === a.id}
              onOp={(id, op) => void onOp(id, op)}
            />
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <BookingHistoryList events={data.history} />
    </section>
  )
}

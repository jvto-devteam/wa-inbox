'use client'
import { valueText, type BookingActionEventView } from '@/lib/booking-actions/view'

export const EVENT_LABELS: Record<string, string> = {
  CREATED: 'Dibuat',
  CORRECTED: 'Dikoreksi',
  EXECUTED: 'Dieksekusi',
  EXECUTE_FAILED: 'Eksekusi gagal',
  REJECTED: 'Ditolak',
  SUPERSEDED: 'Digantikan',
  RESOLVED: 'Selesai',
  DRAFT_SENT: 'Draf terkirim',
  REVERTED: 'Dibatalkan',
}

export function actorName(e: BookingActionEventView): string {
  if (e.actor === 'BOT') return 'Bot'
  if (e.actor === 'SYSTEM') return 'Sistem'
  return e.accountName ?? 'Admin'
}

export function when(iso: string): string {
  return new Date(iso).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' })
}

/** Riwayat tindakan booking, terbaru di atas (urutan dari API dipertahankan). */
export function BookingHistoryList({ events }: { events: BookingActionEventView[] }) {
  if (events.length === 0) return null
  return (
    <details className="text-sm">
      <summary className="focus-ring min-h-11 cursor-pointer py-2.5 text-ink-muted">Riwayat ({events.length})</summary>
      <ul aria-label="Riwayat tindakan booking" className="divide-y divide-line border-y border-line">
        {events.map((e) => (
          <li key={e.id} className="space-y-0.5 py-2 break-words">
            <p className="text-ink">
              <span className="font-medium">{EVENT_LABELS[e.event] ?? e.event}</span> · {actorName(e)}
            </p>
            {(e.oldValue != null || e.newValue != null) && (
              <p className="text-xs text-ink-muted">
                {valueText(e.oldValue)} → {valueText(e.newValue)}
              </p>
            )}
            {e.reason && <p className="text-xs text-ink-muted">{e.reason}</p>}
            <p className="text-xs text-ink-subtle">{when(e.createdAt)}</p>
          </li>
        ))}
      </ul>
    </details>
  )
}

'use client'
import Link from 'next/link'
import { BellOff } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { Panel, PanelError, PanelLoading } from './Panel'
import { formatDue, type DueReminder } from './data'
import { cn } from '@/lib/utils'

/**
 * REMINDER JATUH TEMPO — pengingat yang operator pasang untuk dirinya sendiri.
 *
 * Satu-satunya tempat reminder manual muncul saat jatuh tempo: /summary hanya menampilkan
 * reminder yang lahir dari tombol Ingatkan pada item antreannya.
 */
export function RemindersPanel({
  reminders,
  now,
  error,
  loading,
  onRetry,
  className,
}: {
  reminders: DueReminder[]
  now: Date
  error: string | null
  loading: boolean
  onRetry?: () => void
  className?: string
}) {
  return (
    <Panel
      title="Reminder jatuh tempo"
      subtitle={reminders.length > 0 && !error && !loading ? `${reminders.length} menunggu ditindaklanjuti` : undefined}
      href="/contacts"
      hrefLabel="Kontak"
      className={className}
      bodyClassName={loading || error || reminders.length === 0 ? 'p-4' : ''}
    >
      {loading ? (
        <PanelLoading rows={3} />
      ) : error ? (
        <PanelError message={error} onRetry={onRetry} />
      ) : reminders.length === 0 ? (
        <EmptyState
          icon={<BellOff strokeWidth={1.5} />}
          title="Tidak ada reminder yang jatuh tempo"
          description="Reminder yang dipasang di halaman kontak muncul di sini pada hari jatuh temponya."
          className="px-0 py-4"
        />
      ) : (
        <ul>
          {reminders.map((r) => {
            const due = formatDue(r.dueAt, now)
            return (
              <li key={r.id} className="border-b border-line last:border-b-0">
                {/* Reminder melekat pada KONTAK, bukan percakapan (lihat model Reminder di
                    prisma/schema.prisma), jadi tautannya ke halaman kontak — di sanalah daftar
                    reminder-nya bisa ditandai selesai. */}
                <Link
                  href={`/contacts/${r.contactId}`}
                  className="focus-ring flex items-baseline gap-3 px-4 py-2.5 transition-colors hover:bg-surface-sunken"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base text-ink">{r.note}</span>
                    <span className="block truncate text-sm text-ink-muted">
                      {r.contactName ?? 'Kontak tanpa nama'}
                    </span>
                  </span>
                  <span
                    className={cn(
                      'shrink-0 font-mono text-sm tabular-nums',
                      due.late ? 'font-medium text-warning' : 'text-ink-muted'
                    )}
                  >
                    {due.text}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}

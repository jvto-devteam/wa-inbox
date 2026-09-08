'use client'
import Link from 'next/link'
import { ArrowRight, BellOff, CheckCircle2 } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Panel, PanelError, PanelLoading } from './Panel'
import { formatDue, formatWait, isStale, type DueReminder, type WaitingRow } from './data'
import { cn } from '@/lib/utils'

/** Delapan baris memenuhi tinggi kolom kanan di sebelahnya; sisanya jadi satu tautan ke Inbox. */
const MAX_WAITING_SHOWN = 8

/**
 * ANTREAN CHAT MENUNGGU — panel utama Beranda, dan satu-satunya tempat aksen dibelanjakan.
 *
 * Ia satu-satunya layar di aplikasi ini yang mengurutkan dari yang PALING LAMA menunggu. Sidebar
 * Inbox mengurutkan sebaliknya (pesan terbaru di atas), sehingga pelanggan yang sudah menunggu
 * sejak kemarin justru tenggelam paling dalam persis karena ia belum dijawab. Itulah alasan
 * panel ini ada, dan alasan ia tetap paling besar walaupun Beranda sekarang punya delapan panel.
 */
export function WaitingQueuePanel({
  rows,
  botHeld,
  now,
  error,
  loading,
  onRetry,
  className,
}: {
  rows: WaitingRow[]
  botHeld: number
  now: Date
  error: string | null
  loading: boolean
  onRetry?: () => void
  className?: string
}) {
  const shown = rows.slice(0, MAX_WAITING_SHOWN)
  const hidden = rows.length - shown.length
  const handedOff = rows.filter((r) => r.handedOff).length

  if (loading || error) {
    return (
      <Panel title="Chat menunggu dibalas" href="/inbox" hrefLabel="Inbox" className={className}>
        {error ? <PanelError message={error} onRetry={onRetry} /> : <PanelLoading rows={6} />}
      </Panel>
    )
  }

  if (rows.length === 0) {
    return (
      <Panel title="Chat menunggu dibalas" href="/inbox" hrefLabel="Inbox" className={className} bodyClassName="">
        {/* Kosong di sini adalah KABAR BAIK, bukan kegagalan memuat. Warnanya hijau lembut dan
            kalimatnya menyebut apa yang sedang berjalan, supaya "sepi" tidak terbaca "rusak". */}
        <div className="flex h-full items-center gap-3 bg-success-subtle px-4 py-6">
          <CheckCircle2 aria-hidden="true" className="size-5 shrink-0 text-success" strokeWidth={1.75} />
          <div className="min-w-0">
            <p className="text-base font-medium text-ink">Tidak ada yang menunggu dibalas</p>
            <p className="text-sm text-ink-muted">
              {botHeld > 0
                ? `Semua pelanggan sudah dijawab. ${botHeld} chat lain sedang dipegang bot.`
                : 'Semua pelanggan sudah dijawab.'}
            </p>
          </div>
        </div>
      </Panel>
    )
  }

  return (
    <Panel
      title="Chat menunggu dibalas"
      subtitle={`Paling lama ${formatWait(rows[0].since, now)}${handedOff > 0 ? ` · ${handedOff} diserahkan bot` : ''}`}
      href="/inbox"
      hrefLabel="Inbox"
      className={className}
      bodyClassName=""
      actions={
        <p className="font-mono text-xl leading-none font-semibold text-accent tabular-nums">{rows.length}</p>
      }
    >
      <ul>
        {shown.map((row) => {
          const stale = isStale(row.since, now)
          return (
            <li key={row.id} className="border-b border-line last:border-b-0">
              <Link
                href={`/inbox?conversation=${row.id}`}
                className="focus-ring flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-sunken"
              >
                <Avatar name={row.name} src={row.avatarUrl} alt="" tone="neutral" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-base font-medium text-ink">{row.name}</span>
                    {row.handedOff && <Badge variant="warning">Diserahkan bot</Badge>}
                  </span>
                  <span className="block truncate text-sm text-ink-muted">{row.preview}</span>
                </span>
                <span
                  className={cn(
                    'shrink-0 font-mono text-sm tabular-nums',
                    stale ? 'font-medium text-danger' : 'text-ink-muted'
                  )}
                >
                  {formatWait(row.since, now)}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>

      {hidden > 0 && (
        <Link
          href="/inbox"
          className="focus-ring flex items-center gap-1 border-t border-line px-4 py-2.5 text-sm font-medium text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
        >
          {hidden} chat lain juga menunggu — buka Inbox
          <ArrowRight aria-hidden="true" className="size-3.5" strokeWidth={1.75} />
        </Link>
      )}
    </Panel>
  )
}

/**
 * REMINDER JATUH TEMPO — janji yang operator buat ke dirinya sendiri.
 *
 * Endpoint-nya sendiri (/api/reminders/due) dan bukan `summary.remindersDue`, karena hanya yang
 * pertama membawa `dueAt` dan `contactId`: tanpa keduanya baris ini tidak bisa diklik ke mana
 * pun dan tidak bisa mengaku terlambat berapa lama.
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
          title="Tidak ada janji yang jatuh tempo"
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

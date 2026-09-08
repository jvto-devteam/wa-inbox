'use client'
import { Inbox } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export type OutboundJobRow = {
  id: string
  conversationId: string
  messageId: string | null
  contactName: string | null
  contactPhone: string | null
  channel: string
  provider: string
  status: string
  attempts: number
  maxAttempts: number
  nextAttemptAt: string | null
  lastError: string | null
  createdAt: string
  updatedAt: string
}

export type JobAction = 'retry' | 'cancel'

const STATUS_VARIANT: Record<string, 'success' | 'default' | 'warning' | 'destructive' | 'muted'> = {
  SENT: 'success',
  // Netral, bukan aksen: menunggu giliran bukan kabar baik dan bukan kabar buruk, dan aksen di
  // halaman ini hanya dibelanjakan untuk aksi utama.
  QUEUED: 'default',
  SENDING: 'default',
  RETRYING: 'warning',
  FAILED: 'destructive',
  CANCELLED: 'muted',
}

/** Only a job that has not left yet can be stopped; a SENT one is with the provider already. */
const CANCELLABLE = ['QUEUED', 'RETRYING', 'SENDING']

/**
 * The outbound queue, as a table an operator can act on.
 *
 * `lastError` is shown in full rather than behind a tooltip or a truncation. It is the entire
 * reason somebody opens this page during an incident — "wa-coexist timeout" and "Provider META
 * tidak cocok dengan channel UNOFFICIAL" call for completely different responses, and a row that
 * only says FAILED cannot tell them apart.
 *
 * Actions follow the job's STATE, not just the role: Retry appears on a job that has actually
 * stopped, Cancel on one that has not gone yet. A button that always 409s teaches an operator to
 * stop trusting the page.
 */
export function OutboundQueueTable({
  jobs,
  canRetry = false,
  canCancel = false,
  busyId = null,
  onAction,
}: {
  jobs: OutboundJobRow[]
  canRetry?: boolean
  canCancel?: boolean
  busyId?: string | null
  onAction?: (job: OutboundJobRow, action: JobAction) => void
}) {
  if (jobs.length === 0) {
    // Antrean kosong adalah keadaan NORMAL di halaman ini, bukan kasus pinggiran: antreannya
    // menguras dirinya sendiri. Karena itu kalimatnya menerangkan, bukan menawarkan tombol.
    return (
      <EmptyState
        icon={<Inbox strokeWidth={1.75} />}
        title="Tidak ada job yang cocok dengan filter."
        description="Antrean yang bersih memang terlihat seperti ini. Kalau sedang menyaring, longgarkan filternya untuk melihat sisa antrean."
        className="border-t border-line"
      />
    )
  }

  const showActions = (canRetry || canCancel) && onAction !== undefined

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-32">Status</TableHead>
          <TableHead className="w-44">Kontak</TableHead>
          <TableHead className="w-32">Channel</TableHead>
          <TableHead className="w-20 text-right">Percobaan</TableHead>
          <TableHead>Error terakhir</TableHead>
          <TableHead className="w-40">Dibuat</TableHead>
          {showActions && <TableHead className="w-28">Aksi</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {jobs.map((job) => (
          <TableRow key={job.id} className="h-auto align-top">
            <TableCell className="py-2.5">
              <Badge variant={STATUS_VARIANT[job.status] ?? 'default'}>{job.status}</Badge>
              {job.nextAttemptAt && job.status === 'RETRYING' && (
                <p className="mt-1 text-xs whitespace-nowrap text-ink-muted">
                  Coba lagi {new Date(job.nextAttemptAt).toLocaleString('id-ID')}
                </p>
              )}
            </TableCell>
            <TableCell className="py-2.5 text-sm text-ink">
              {/* The job outlives a deleted conversation; an empty cell would read as a bug. */}
              {job.contactName ?? job.contactPhone ?? (
                <span className="text-ink-subtle">(kontak terhapus)</span>
              )}
            </TableCell>
            <TableCell className="py-2.5 text-sm text-ink-muted">
              {job.channel}
              <span className="block font-mono text-xs">{job.provider}</span>
            </TableCell>
            <TableCell className="py-2.5 text-right font-mono text-xs text-ink-muted">
              {job.attempts}/{job.maxAttempts}
            </TableCell>
            {/* Ditulis penuh, tidak dipotong dan tidak disembunyikan di balik tooltip: inilah
                satu-satunya alasan orang membuka halaman ini saat provider bermasalah. */}
            <TableCell className="max-w-md py-2.5 text-sm text-danger">
              {job.lastError ?? <span className="text-ink-subtle">—</span>}
            </TableCell>
            <TableCell className="py-2.5 text-sm whitespace-nowrap text-ink-muted">
              <time dateTime={job.createdAt}>{new Date(job.createdAt).toLocaleString('id-ID')}</time>
            </TableCell>
            {showActions && (
              <TableCell className="py-2">
                <div className="flex flex-col items-start gap-1">
                  {canRetry && job.status === 'FAILED' && job.messageId && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busyId === job.id}
                      onClick={() => onAction?.(job, 'retry')}
                    >
                      Kirim ulang
                    </Button>
                  )}
                  {canCancel && CANCELLABLE.includes(job.status) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busyId === job.id}
                      onClick={() => onAction?.(job, 'cancel')}
                    >
                      Batalkan
                    </Button>
                  )}
                </div>
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

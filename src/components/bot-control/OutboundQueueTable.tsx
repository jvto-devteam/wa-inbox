'use client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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

const STATUS_VARIANT: Record<string, 'success' | 'brand' | 'warning' | 'destructive' | 'muted'> = {
  SENT: 'success',
  QUEUED: 'brand',
  SENDING: 'brand',
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
    return <p className="p-3 text-sm text-muted-foreground">Tidak ada job yang cocok dengan filter.</p>
  }

  const showActions = (canRetry || canCancel) && onAction !== undefined

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Status</TableHead>
          <TableHead>Kontak</TableHead>
          <TableHead>Channel</TableHead>
          <TableHead className="text-right">Percobaan</TableHead>
          <TableHead>Error terakhir</TableHead>
          <TableHead>Dibuat</TableHead>
          {showActions && <TableHead />}
        </TableRow>
      </TableHeader>
      <TableBody>
        {jobs.map((job) => (
          <TableRow key={job.id}>
            <TableCell>
              <Badge variant={STATUS_VARIANT[job.status] ?? 'default'}>{job.status}</Badge>
              {job.nextAttemptAt && job.status === 'RETRYING' && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Coba lagi {new Date(job.nextAttemptAt).toLocaleString('id-ID')}
                </p>
              )}
            </TableCell>
            <TableCell className="text-xs">
              {/* The job outlives a deleted conversation; an empty cell would read as a bug. */}
              {job.contactName ?? job.contactPhone ?? (
                <span className="text-muted-foreground">(kontak terhapus)</span>
              )}
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {job.channel}
              <span className="block font-mono">{job.provider}</span>
            </TableCell>
            <TableCell className="text-right text-xs tabular-nums">
              {job.attempts}/{job.maxAttempts}
            </TableCell>
            <TableCell className="max-w-xs text-xs text-destructive">{job.lastError ?? '—'}</TableCell>
            <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
              {new Date(job.createdAt).toLocaleString('id-ID')}
            </TableCell>
            {showActions && (
              <TableCell>
                <div className="flex flex-col items-start gap-1">
                  {canRetry && job.status === 'FAILED' && job.messageId && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busyId === job.id}
                      onClick={() => onAction?.(job, 'retry')}
                    >
                      Kirim ulang
                    </Button>
                  )}
                  {canCancel && CANCELLABLE.includes(job.status) && (
                    <Button
                      variant="outline"
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

'use client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export type KnowledgeSourceRow = {
  id: string
  key: string
  title: string
  type: string
  sourcePath: string | null
  status: string
  summary: string | null
  chunkCount: number
  lastSyncedAt: string | null
  /** True for operator-written knowledge; false for a mirror of a catalog/*.json file. */
  managed?: boolean
  hasDraft?: boolean
  latestRevision?: { id: string; version: number; status: string } | null
}

export type KnowledgeAction = 'edit' | 'history' | 'request-review' | 'approve' | 'reject' | 'archive'

const STATUS_VARIANT: Record<string, 'success' | 'muted' | 'warning' | 'brand' | 'destructive'> = {
  PUBLISHED: 'success',
  DRAFT: 'brand',
  REVIEW: 'warning',
  APPROVED: 'brand',
  REJECTED: 'destructive',
  ARCHIVED: 'muted',
}

/** "2026-09-05T03:00:00.000Z" -> "5/9/2026, 10.00.00". Null renders as "belum pernah". */
function formatSynced(value: string | null): string {
  if (!value) return 'Belum pernah'
  return new Date(value).toLocaleString('id-ID')
}

/**
 * The knowledge list, with management controls for the sources that have them.
 *
 * Controls appear only on MANAGED rows. A catalog mirror is written by the indexer from a file
 * on disk and overwritten on every sync — offering an Edit button there would hand an operator
 * a form whose contents vanish at the next `Index ulang katalog`, which is worse than offering
 * nothing at all.
 */
export function KnowledgeSourceTable({
  sources,
  selectedId,
  onSelect,
  canEdit = false,
  canApprove = false,
  onAction,
}: {
  sources: KnowledgeSourceRow[]
  selectedId: string | null
  onSelect: (id: string) => void
  canEdit?: boolean
  canApprove?: boolean
  onAction?: (source: KnowledgeSourceRow, action: KnowledgeAction) => void
}) {
  if (sources.length === 0) {
    return (
      <p className="p-3 text-sm text-muted-foreground">
        Belum ada sumber knowledge ter-index. Jalankan &ldquo;Index ulang katalog&rdquo; untuk membacanya dari{' '}
        <span className="font-mono">catalog/</span>.
      </p>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Judul</TableHead>
          <TableHead>Tipe</TableHead>
          <TableHead>Path sumber</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Chunk</TableHead>
          <TableHead>Terakhir sinkron</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {sources.map((source) => (
          <TableRow key={source.id} className={source.id === selectedId ? 'bg-brand/5' : undefined}>
            <TableCell>
              <p className="font-medium text-navy">{source.title}</p>
              {source.summary && <p className="text-xs text-muted-foreground">{source.summary}</p>}
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">{source.type}</TableCell>
            {/* The whole point of the column: an operator can go straight to the file on disk. */}
            <TableCell className="font-mono text-xs break-all text-muted-foreground">
              {source.sourcePath ?? '—'}
            </TableCell>
            <TableCell>
              <Badge variant={STATUS_VARIANT[source.status] ?? 'default'}>{source.status}</Badge>
              {/* The revision's state is shown separately from the source's. One answers "is
                  the bot using this", the other "is there something waiting" — merging them
                  would make a pending draft read as though it were already live. */}
              {source.latestRevision && source.hasDraft && (
                <p className="mt-1">
                  <Badge variant={STATUS_VARIANT[source.latestRevision.status] ?? 'muted'}>
                    v{source.latestRevision.version}: {source.latestRevision.status}
                  </Badge>
                </p>
              )}
            </TableCell>
            <TableCell className="text-right tabular-nums">{source.chunkCount}</TableCell>
            <TableCell className="text-xs text-muted-foreground">{formatSynced(source.lastSyncedAt)}</TableCell>
            <TableCell>
              <div className="flex flex-col items-start gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onSelect(source.id)}
                  aria-pressed={source.id === selectedId}
                >
                  Lihat isi
                </Button>
                {source.managed && onAction && (
                  <>
                    <Button variant="outline" size="sm" onClick={() => onAction(source, 'history')}>
                      Riwayat
                    </Button>
                    {canEdit && source.status !== 'ARCHIVED' && (
                      <Button variant="outline" size="sm" onClick={() => onAction(source, 'edit')}>
                        Edit isi
                      </Button>
                    )}
                    {/* Each control follows the revision's STATE, not just the role: a button
                        that always 409s teaches an operator to stop trusting the page. */}
                    {canEdit && source.latestRevision?.status === 'DRAFT' && (
                      <Button variant="outline" size="sm" onClick={() => onAction(source, 'request-review')}>
                        Kirim ke review
                      </Button>
                    )}
                    {canApprove && source.latestRevision?.status === 'REVIEW' && (
                      <Button variant="outline" size="sm" onClick={() => onAction(source, 'approve')}>
                        Approve
                      </Button>
                    )}
                    {canApprove && source.hasDraft && (
                      <Button variant="outline" size="sm" onClick={() => onAction(source, 'reject')}>
                        Reject
                      </Button>
                    )}
                    {canApprove && source.status !== 'ARCHIVED' && (
                      <Button variant="outline" size="sm" onClick={() => onAction(source, 'archive')}>
                        Arsipkan
                      </Button>
                    )}
                    {source.latestRevision?.status === 'APPROVED' && (
                      <span className="text-xs text-muted-foreground">Menunggu publish lewat Releases</span>
                    )}
                  </>
                )}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

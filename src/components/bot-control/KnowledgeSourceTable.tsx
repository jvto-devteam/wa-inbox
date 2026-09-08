'use client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export type KnowledgeSourceRow = {
  id: string
  key: string
  title: string
  status: string
  summary: string | null
  hasDraft?: boolean
  latestRevision?: { id: string; version: number; status: string } | null
}

export type KnowledgeAction = 'edit' | 'history' | 'publish' | 'archive'

const STATUS_VARIANT: Record<string, 'success' | 'muted' | 'brand'> = {
  PUBLISHED: 'success',
  DRAFT: 'brand',
  ARCHIVED: 'muted',
}

/**
 * The operator-written knowledge list, with its management controls.
 *
 * Every row here is a `type='MANUAL'` source now. The table used to also list one row per
 * `catalog/*.json` file — a database mirror of disk, with columns for its file path, chunk
 * count and last sync time. The bot never read that mirror, so it has been removed and the
 * catalog is shown by CatalogEntryPanel straight from disk instead; those three columns went
 * with it, along with the "Lihat isi" selection, because a managed source's content is opened
 * with Edit or Riwayat, not by filtering a chunk panel.
 */
export function KnowledgeSourceTable({
  sources,
  canEdit = false,
  onAction,
}: {
  sources: KnowledgeSourceRow[]
  /**
   * One permission, not two. There used to be a second `canApprove` for the review flow;
   * with the writer and the activator being the same person, a second flag only invited the
   * two to be passed different values and the buttons to disagree with the API.
   */
  canEdit?: boolean
  onAction?: (source: KnowledgeSourceRow, action: KnowledgeAction) => void
}) {
  if (sources.length === 0) {
    return (
      <p className="p-3 text-sm text-muted-foreground">
        Belum ada knowledge terkelola. Pakai &ldquo;Buat knowledge baru&rdquo; untuk menulis jawaban yang tidak ada di{' '}
        <span className="font-mono">catalog/</span>.
      </p>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Judul</TableHead>
          <TableHead>Status</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {sources.map((source) => (
          <TableRow key={source.id}>
            <TableCell>
              <p className="font-medium text-navy">{source.title}</p>
              {source.summary && <p className="text-xs text-muted-foreground">{source.summary}</p>}
            </TableCell>
            <TableCell>
              <Badge variant={STATUS_VARIANT[source.status] ?? 'default'}>{source.status}</Badge>
              {/* The revision's state is shown separately from the source's. One answers "is
                  the bot using this", the other "is there something written but not yet
                  activated" — merging them would make a draft read as though it were live. */}
              {source.latestRevision && source.hasDraft && (
                <p className="mt-1">
                  <Badge variant={STATUS_VARIANT[source.latestRevision.status] ?? 'muted'}>
                    v{source.latestRevision.version}: {source.latestRevision.status}
                  </Badge>
                </p>
              )}
            </TableCell>
            <TableCell>
              <div className="flex flex-col items-start gap-1">
                {onAction && (
                  <>
                    <Button variant="outline" size="sm" onClick={() => onAction(source, 'history')}>
                      Riwayat
                    </Button>
                    {canEdit && source.status !== 'ARCHIVED' && (
                      <Button variant="outline" size="sm" onClick={() => onAction(source, 'edit')}>
                        Edit isi
                      </Button>
                    )}
                    {/* The control follows the revision's STATE, not just the role: a button
                        that always 409s teaches an operator to stop trusting the page. */}
                    {canEdit && source.status !== 'ARCHIVED' && source.latestRevision?.status === 'DRAFT' && (
                      <Button variant="outline" size="sm" onClick={() => onAction(source, 'publish')}>
                        Aktifkan
                      </Button>
                    )}
                    {canEdit && source.status !== 'ARCHIVED' && (
                      <Button variant="outline" size="sm" onClick={() => onAction(source, 'archive')}>
                        Arsipkan
                      </Button>
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

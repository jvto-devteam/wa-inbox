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
}

const STATUS_VARIANT: Record<string, 'success' | 'muted' | 'warning'> = {
  PUBLISHED: 'success',
  DRAFT: 'warning',
  REVIEW: 'warning',
  ARCHIVED: 'muted',
}

/** "2026-09-05T03:00:00.000Z" -> "5/9/2026, 10.00.00". Null renders as "belum pernah". */
function formatSynced(value: string | null): string {
  if (!value) return 'Belum pernah'
  return new Date(value).toLocaleString('id-ID')
}

export function KnowledgeSourceTable({
  sources,
  selectedId,
  onSelect,
}: {
  sources: KnowledgeSourceRow[]
  selectedId: string | null
  onSelect: (id: string) => void
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
            </TableCell>
            <TableCell className="text-right tabular-nums">{source.chunkCount}</TableCell>
            <TableCell className="text-xs text-muted-foreground">{formatSynced(source.lastSyncedAt)}</TableCell>
            <TableCell>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onSelect(source.id)}
                aria-pressed={source.id === selectedId}
              >
                Lihat isi
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

'use client'
import { BookOpen } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { ResolverTopic } from '@/lib/bot/module-resolver'

export type KnowledgeSourceRow = {
  id: string
  key: string
  title: string
  status: string
  summary: string | null
  hasDraft?: boolean
  latestRevision?: { id: string; version: number; status: string } | null
  /** Task 9: which of the 14 topics the latest revision's items answer, so a classifier
   * misfire (Task 8's risk) is visible on the list without opening the editor. */
  topics: ResolverTopic[]
}

export type KnowledgeAction = 'edit' | 'history' | 'publish' | 'archive'

const STATUS_VARIANT: Record<string, 'success' | 'muted' | 'default'> = {
  PUBLISHED: 'success',
  DRAFT: 'default',
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
  // Wadahnya sama di kedua keadaan: kotak yang hilang saat daftarnya kosong membuat bagian ini
  // terlihat gagal dimuat, bukan kosong.
  if (sources.length === 0) {
    return (
      <TableContainer>
        <EmptyState
          icon={<BookOpen strokeWidth={1.75} />}
          title="Belum ada knowledge terkelola."
          description="Pakai “Buat knowledge baru” untuk menulis jawaban yang tidak ada di catalog/. Katalog di atas tetap dibaca bot walaupun daftar ini kosong."
        />
      </TableContainer>
    )
  }

  return (
    <TableContainer>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Judul</TableHead>
            <TableHead className="w-48">Status</TableHead>
            <TableHead className="w-36">Aksi</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sources.map((source) => (
            <TableRow key={source.id} className="h-auto align-top">
              <TableCell className="py-2.5">
                <p className="font-medium text-ink">{source.title}</p>
                {/* Ringkasannya prosa: kolomnya boleh selebar apa pun, barisnya tidak. */}
                {source.summary && <p className="max-w-4xl text-sm text-ink-muted">{source.summary}</p>}
                {/* Bukan hiasan: topik yang salah harus terlihat tanpa membuka form.
                    `?? []` defensif: baris dari caller yang belum diperbarui ke bentuk GET
                    Task 9 (mis. fixture test halaman lama) tidak boleh merusak render tabel. */}
                {(source.topics ?? []).length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {source.topics.map((topic) => (
                      <Badge key={topic} variant="muted">
                        {topic}
                      </Badge>
                    ))}
                  </div>
                )}
              </TableCell>
              <TableCell className="py-2.5">
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
              <TableCell className="py-2">
                <div className="flex flex-col items-start gap-0.5">
                  {onAction && (
                    <>
                      <Button variant="ghost" size="sm" onClick={() => onAction(source, 'history')}>
                        Riwayat
                      </Button>
                      {canEdit && source.status !== 'ARCHIVED' && (
                        <Button variant="ghost" size="sm" onClick={() => onAction(source, 'edit')}>
                          Edit isi
                        </Button>
                      )}
                      {/* The control follows the revision's STATE, not just the role: a button
                          that always 409s teaches an operator to stop trusting the page. */}
                      {canEdit && source.status !== 'ARCHIVED' && source.latestRevision?.status === 'DRAFT' && (
                        <Button variant="ghost" size="sm" onClick={() => onAction(source, 'publish')}>
                          Aktifkan
                        </Button>
                      )}
                      {canEdit && source.status !== 'ARCHIVED' && (
                        <Button variant="ghost" size="sm" onClick={() => onAction(source, 'archive')}>
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
    </TableContainer>
  )
}

'use client'
import { Badge } from '@/components/ui/badge'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'

export type RevisionRow = {
  id: string
  version: number
  title: string
  summary: string | null
  status: string
  changeReason: string | null
  createdByName: string | null
  reviewedByName: string | null
  reviewedAt: string | null
  publishedAt: string | null
  releaseId: string | null
  createdAt: string
  updatedAt: string
}

const STATUS_VARIANT: Record<string, 'success' | 'muted' | 'warning' | 'brand' | 'destructive'> = {
  PUBLISHED: 'success',
  DRAFT: 'brand',
  REVIEW: 'warning',
  APPROVED: 'brand',
  REJECTED: 'destructive',
  ARCHIVED: 'muted',
}

/**
 * The history of one knowledge source, newest first.
 *
 * This is the answer to "what did the bot know last Tuesday", which is the reason revisions are
 * rows rather than a column that gets overwritten. `changeReason` is shown on every row for the
 * same reason it is required on every write: the version numbers say WHAT changed and the
 * reason says why, and only the pair is any use months later.
 *
 * Rejected revisions are shown, not hidden. A rejected revision usually explains why the
 * current answer is worded the way it is — filtering it out would remove the most useful row
 * on the page.
 */
export function KnowledgeRevisionPanel({
  sourceTitle,
  revisions,
  loading,
  error,
  onClose,
}: {
  sourceTitle: string
  revisions: RevisionRow[]
  loading: boolean
  error: string | null
  onClose: () => void
}) {
  return (
    <Modal onClose={onClose} className="max-h-[85vh] w-full max-w-2xl space-y-3 overflow-y-auto p-4">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold text-navy">Riwayat revisi</h2>
        <p className="text-xs text-muted-foreground">{sourceTitle}</p>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Memuat riwayat...</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {!loading && !error && revisions.length === 0 && (
        <p className="text-sm text-muted-foreground">Sumber ini belum punya revisi.</p>
      )}

      {!loading && !error && revisions.length > 0 && (
        <ol className="space-y-2">
          {revisions.map((revision) => (
            <li key={revision.id} className="space-y-1 rounded border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-navy">v{revision.version}</span>
                <Badge variant={STATUS_VARIANT[revision.status] ?? 'default'}>{revision.status}</Badge>
                <span className="ml-auto text-xs text-muted-foreground">
                  {new Date(revision.createdAt).toLocaleString('id-ID')}
                </span>
              </div>

              <p className="text-sm text-navy">{revision.title}</p>
              {revision.summary && <p className="text-xs text-muted-foreground">{revision.summary}</p>}

              {revision.changeReason && (
                <p className="text-xs text-navy">Alasan: {revision.changeReason}</p>
              )}

              <p className="text-xs text-muted-foreground">
                {/* Null when the account is gone. The revision outlives whoever wrote it, and an
                    empty name is more honest than inventing one. */}
                Ditulis {revision.createdByName ?? '(akun terhapus)'}
                {revision.reviewedByName && ` · direview ${revision.reviewedByName}`}
                {revision.publishedAt && ` · terbit ${new Date(revision.publishedAt).toLocaleString('id-ID')}`}
              </p>
            </li>
          ))}
        </ol>
      )}

      <Button type="button" variant="outline" onClick={onClose}>
        Tutup
      </Button>
    </Modal>
  )
}

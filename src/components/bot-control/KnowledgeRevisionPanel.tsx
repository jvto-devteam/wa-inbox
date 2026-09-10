'use client'
import { Badge } from '@/components/ui/badge'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { SkeletonText } from '@/components/ui/skeleton'
import type { ResolverTopic } from '@/lib/bot/module-resolver'

export type RevisionRow = {
  id: string
  version: number
  title: string
  summary: string | null
  status: string
  changeReason: string | null
  createdByName: string | null
  publishedByName: string | null
  publishedAt: string | null
  createdAt: string
  updatedAt: string
  /** Task 9: which of the 14 topics this revision's items answer — visible per row so a wrong
   * classification is caught without opening the editor. */
  topics: ResolverTopic[]
}

const STATUS_VARIANT: Record<string, 'success' | 'muted' | 'default'> = {
  PUBLISHED: 'success',
  DRAFT: 'default',
  // Written by the system, never chosen: the revision a newer one replaced.
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
 * Every revision is shown, including drafts that were superseded before anyone activated them.
 * A version that never went live still explains why the one that did is worded the way it is.
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
      <div className="space-y-0.5 border-b border-line pb-3">
        <h2 className="text-base font-semibold text-ink">Riwayat revisi</h2>
        <p className="text-sm text-ink-muted">{sourceTitle}</p>
      </div>

      {loading && <SkeletonText lines={4} />}
      {error && <p className="text-base text-danger">{error}</p>}

      {!loading && !error && revisions.length === 0 && (
        <p className="text-base text-ink-muted">Sumber ini belum punya revisi.</p>
      )}

      {!loading && !error && revisions.length > 0 && (
        <ol className="divide-y divide-line border-b border-line">
          {revisions.map((revision) => (
            <li key={revision.id} className="space-y-1 py-3 first:pt-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-ink">v{revision.version}</span>
                <Badge variant={STATUS_VARIANT[revision.status] ?? 'default'}>{revision.status}</Badge>
                <time dateTime={revision.createdAt} className="ml-auto text-xs text-ink-muted">
                  {new Date(revision.createdAt).toLocaleString('id-ID')}
                </time>
              </div>

              <p className="text-base font-medium text-ink">{revision.title}</p>
              {revision.summary && <p className="text-sm text-ink-muted">{revision.summary}</p>}
              {/* `?? []` defensif, sama seperti KnowledgeSourceTable: baris dari caller yang
                  belum diperbarui ke bentuk GET Task 9 tidak boleh merusak render panel. */}
              {(revision.topics ?? []).length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {revision.topics.map((topic) => (
                    <Badge key={topic} variant="muted">
                      {topic}
                    </Badge>
                  ))}
                </div>
              )}

              {revision.changeReason && (
                <p className="text-sm text-ink">Alasan: {revision.changeReason}</p>
              )}

              <p className="text-xs text-ink-subtle">
                {/* Null when the account is gone. The revision outlives whoever wrote it, and an
                    empty name is more honest than inventing one. */}
                Ditulis {revision.createdByName ?? '(akun terhapus)'}
                {revision.publishedByName && ` · diaktifkan ${revision.publishedByName}`}
                {revision.publishedAt && ` · terbit ${new Date(revision.publishedAt).toLocaleString('id-ID')}`}
              </p>
            </li>
          ))}
        </ol>
      )}

      <div className="flex justify-end">
        <Button type="button" variant="outline" onClick={onClose}>
          Tutup
        </Button>
      </div>
    </Modal>
  )
}

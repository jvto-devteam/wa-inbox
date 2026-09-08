'use client'
import { FileText } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { TemplatePreviewBubble, type TemplatePreviewData } from '@/components/inbox/TemplatePreviewBubble'

export type MetaStatus = 'APPROVED' | 'PENDING' | 'REJECTED' | 'NOT_APPLICABLE'

const metaStatusVariant: Record<MetaStatus, 'success' | 'warning' | 'destructive' | 'muted'> = {
  APPROVED: 'success',
  PENDING: 'warning',
  REJECTED: 'destructive',
  NOT_APPLICABLE: 'muted',
}

const metaStatusLabel: Record<MetaStatus, string> = {
  APPROVED: 'Disetujui',
  PENDING: 'Menunggu',
  REJECTED: 'Ditolak',
  NOT_APPLICABLE: 'Tidak berlaku',
}

export type GridTemplate = TemplatePreviewData & {
  id: string
  metaStatus: MetaStatus
  category: string | null
}

/**
 * The template list as a grid with a live inline preview per template -- matching waba-jvto's
 * own template-grid.tsx -- instead of the plain text-row table this page used to render. This
 * is one of the few places a card grid is the honest shape: each cell holds a rendered
 * message bubble, not a row of fields.
 */
export function TemplateGrid({
  templates,
  showStatus,
  onDelete,
}: {
  templates: GridTemplate[]
  showStatus: boolean
  onDelete: (id: string) => void
}) {
  if (templates.length === 0) {
    return (
      <EmptyState
        icon={<FileText />}
        title="Belum ada template"
        description="Buat satu di formulir di atas — template yang disimpan langsung bisa dipakai agen di Inbox."
      />
    )
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {templates.map((t) => (
        <div key={t.id} className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-2">
          <TemplatePreviewBubble template={t} />
          <div className="mt-auto flex items-center justify-between gap-2 border-t border-line px-1 pt-2">
            <span className="truncate text-xs text-ink-muted">{t.category ?? '-'}</span>
            <div className="flex shrink-0 items-center gap-1.5">
              {showStatus && <Badge variant={metaStatusVariant[t.metaStatus]}>{metaStatusLabel[t.metaStatus]}</Badge>}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-danger hover:bg-danger-subtle hover:text-danger"
                onClick={() => {
                  if (confirm(`Hapus template "${t.name}"?`)) onDelete(t.id)
                }}
              >
                Hapus
              </Button>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

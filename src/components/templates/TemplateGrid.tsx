'use client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
 * The template list as a card grid with a live inline preview per card -- matching
 * waba-jvto's own template-grid.tsx (cards, not a table) -- instead of the plain text-row
 * table this page used to render.
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
    return <p className="text-sm text-muted-foreground">Belum ada template.</p>
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {templates.map((t) => (
        <div key={t.id} className="space-y-2 rounded-lg border border-border bg-white p-2">
          <TemplatePreviewBubble template={t} />
          <div className="flex items-center justify-between gap-2 px-1">
            <span className="truncate text-xs text-muted-foreground">{t.category ?? '-'}</span>
            {showStatus && <Badge variant={metaStatusVariant[t.metaStatus]}>{metaStatusLabel[t.metaStatus]}</Badge>}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full text-destructive hover:bg-destructive/10"
            onClick={() => {
              if (confirm(`Hapus template "${t.name}"?`)) onDelete(t.id)
            }}
          >
            Hapus
          </Button>
        </div>
      ))}
    </div>
  )
}

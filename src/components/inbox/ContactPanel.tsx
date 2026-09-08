'use client'
import { useEffect, useState } from 'react'
import { Select } from '@/components/ui/select'
import { Skeleton, SkeletonText } from '@/components/ui/skeleton'
import { ContactAvatar } from '@/components/ContactAvatar'
import { cn } from '@/lib/utils'
import { LabelPicker, type LabelOption } from './LabelPicker'
import { NotesSection } from './NotesSection'
import { RemindersSection } from './RemindersSection'
import { BookingSummary, type BookingData, type TripBrief } from '@/components/contacts/BookingSummary'
import { fetchJson } from '@/lib/fetch-json'
import { PIPELINE_STAGES } from '@/lib/pipeline'

type ContactDetail = {
  botEnabled: boolean
  contactId: string
  contactName: string | null
  avatarUrl: string | null
  source: string | null
  bookingData: BookingData | null
  tripBrief: TripBrief
  labels: LabelOption[]
  pipelineStage: string
}

/**
 * Judul bagian di panel kanan. Empat berkas (panel ini, LabelPicker, NotesSection,
 * RemindersSection) sebelumnya menulis `<h3 className="text-xs font-medium uppercase
 * tracking-wide text-muted-foreground">` masing-masing; empat salinan dari satu keputusan
 * berarti empat kesempatan untuk berbeda.
 */
export function PanelSectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-xs font-semibold tracking-wide text-ink-subtle uppercase">{children}</h3>
}

function ContactPanelSkeleton({ className }: { className?: string }) {
  return (
    <aside
      aria-label="Info kontak"
      aria-busy="true"
      className={cn('flex h-full min-h-0 flex-col gap-4 border-l border-line bg-surface p-4', className)}
    >
      <div className="flex items-center gap-2.5">
        <Skeleton className="size-10 shrink-0 rounded-full" />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <Skeleton className="h-3.5 w-2/3" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      </div>
      <SkeletonText lines={4} />
      <SkeletonText lines={3} />
    </aside>
  )
}

export function ContactPanel({ conversationId, className }: { conversationId: string; className?: string }) {
  const [detail, setDetail] = useState<ContactDetail | null>(null)
  const [allLabels, setAllLabels] = useState<LabelOption[]>([])
  const [pipelineError, setPipelineError] = useState<string | null>(null)

  useEffect(() => {
    fetchJson<ContactDetail>(`/api/conversations/${conversationId}`).then(setDetail).catch(() => {})
    fetchJson<LabelOption[]>('/api/labels').then(setAllLabels).catch(() => {})
  }, [conversationId])

  // Mirrors LabelPicker's pattern: the pipeline stage drives follow-up/triage
  // decisions, so the dropdown must only ever reflect what the server confirmed —
  // no optimistic update. Await the response and only update displayed state on success.
  async function changePipelineStage(stage: string) {
    setPipelineError(null)
    try {
      const res = await fetch(`/api/conversations/${conversationId}/pipeline`, {
        method: 'PATCH',
        body: JSON.stringify({ stage }),
      })
      if (!res.ok) {
        setPipelineError('Gagal mengubah status pipeline')
        return
      }
      const updated = await res.json()
      setDetail((prev) => (prev ? { ...prev, pipelineStage: updated.pipelineStage } : prev))
    } catch {
      setPipelineError('Gagal mengubah status pipeline')
    }
  }

  if (!detail) return <ContactPanelSkeleton className={className} />

  return (
    // Kolom ketiga menggulung sendiri, sama seperti dua yang lain. `className` datang dari
    // /inbox dan hanya pernah berisi aturan tampil/sembunyi per lebar layar -- itulah sebabnya
    // `flex` ada di sana dan bukan di sini.
    <aside
      aria-label="Info kontak"
      className={cn(
        'flex h-full min-h-0 flex-col gap-4 overflow-y-auto overscroll-contain border-l border-line bg-surface p-4',
        className
      )}
    >
      <div className="flex items-center gap-2.5">
        <ContactAvatar name={detail.contactName} avatarUrl={detail.avatarUrl} />
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-ink">{detail.contactName ?? 'Tanpa nama'}</p>
          {detail.source && <p className="truncate text-xs text-ink-muted">{detail.source}</p>}
        </div>
      </div>

      <BookingSummary bookingData={detail.bookingData} tripBrief={detail.tripBrief} />

      <div className="space-y-2">
        <PanelSectionTitle>Tahap Pipeline</PanelSectionTitle>
        <Select
          aria-label="Tahap pipeline"
          value={detail.pipelineStage}
          onChange={(e) => changePipelineStage(e.target.value)}
          className="w-full"
        >
          {PIPELINE_STAGES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
        {pipelineError && (
          <p role="alert" className="text-xs text-danger">
            {pipelineError}
          </p>
        )}
      </div>

      <LabelPicker
        conversationId={conversationId}
        allLabels={allLabels}
        attachedLabels={detail.labels}
        onAttachedChange={(labels) => setDetail((prev) => (prev ? { ...prev, labels } : prev))}
      />

      <RemindersSection contactId={detail.contactId} />

      <NotesSection contactId={detail.contactId} />
    </aside>
  )
}

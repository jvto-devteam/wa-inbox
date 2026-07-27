'use client'
import { useEffect, useState } from 'react'
import { Select } from '@/components/ui/select'
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

export function ContactPanel({ conversationId }: { conversationId: string }) {
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

  if (!detail) return <div className="border-l border-border p-4 text-sm text-muted-foreground">Memuat...</div>

  const initial = (detail.contactName ?? '?').trim().charAt(0).toUpperCase()

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto border-l border-border bg-white p-4">
      <div className="flex items-center gap-3">
        {detail.avatarUrl ? (
          <img
            src={detail.avatarUrl}
            alt={detail.contactName ?? 'Kontak'}
            className="size-10 rounded-full object-cover"
          />
        ) : (
          <div className="flex size-10 items-center justify-center rounded-full bg-navy text-sm font-medium text-white">
            {initial}
          </div>
        )}
        <div>
          <p className="font-medium text-navy">{detail.contactName ?? 'Tanpa nama'}</p>
          {detail.source && <p className="text-xs text-muted-foreground">{detail.source}</p>}
        </div>
      </div>

      <BookingSummary bookingData={detail.bookingData} tripBrief={detail.tripBrief} />

      <div className="space-y-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Tahap Pipeline</h3>
        <Select
          aria-label="Tahap pipeline"
          value={detail.pipelineStage}
          onChange={(e) => changePipelineStage(e.target.value)}
          className="w-auto"
        >
          {PIPELINE_STAGES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
        {pipelineError && <p className="text-xs text-destructive">{pipelineError}</p>}
      </div>

      <LabelPicker
        conversationId={conversationId}
        allLabels={allLabels}
        attachedLabels={detail.labels}
        onAttachedChange={(labels) => setDetail((prev) => (prev ? { ...prev, labels } : prev))}
      />

      <RemindersSection contactId={detail.contactId} />

      <NotesSection contactId={detail.contactId} />
    </div>
  )
}

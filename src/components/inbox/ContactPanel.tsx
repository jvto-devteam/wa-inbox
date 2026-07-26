'use client'
import { useEffect, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Select } from '@/components/ui/select'
import { LabelPicker, type LabelOption } from './LabelPicker'
import { NotesSection } from './NotesSection'
import { RemindersSection } from './RemindersSection'

const PIPELINE_STAGES = [
  { value: 'new', label: 'Baru' },
  { value: 'nego', label: 'Negosiasi' },
  { value: 'booked', label: 'Booked' },
  { value: 'lunas', label: 'Lunas' },
] as const

type BookingData = {
  destination?: string
  dateRange?: string
  pax?: number
  amountPaid?: number
  amountDue?: number
  status?: string
} | null

type TripBrief = {
  destination?: string
  dateRange?: string
  pax?: number
} | null

type ContactDetail = {
  botEnabled: boolean
  contactId: string
  contactName: string | null
  avatarUrl: string | null
  source: string | null
  bookingData: BookingData
  tripBrief: TripBrief
  labels: LabelOption[]
  pipelineStage: string
}

function hasAnyValue(obj: Record<string, unknown> | null | undefined) {
  return !!obj && Object.values(obj).some((v) => v !== null && v !== undefined && v !== '')
}

function formatIDR(amount: number) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(amount)
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium text-navy">{value}</dd>
    </div>
  )
}

export function ContactPanel({ conversationId }: { conversationId: string }) {
  const [detail, setDetail] = useState<ContactDetail | null>(null)
  const [allLabels, setAllLabels] = useState<LabelOption[]>([])
  const [pipelineError, setPipelineError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/conversations/${conversationId}`).then((r) => r.json()).then(setDetail)
    fetch('/api/labels').then((r) => r.json()).then(setAllLabels)
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
  // A brand-new conversation has neither a verified booking nor any funnel-collected brief data yet
  // — that's a third state, distinct from Mode 3 (booking) and Mode 1/2 (funnel-only lead).
  const isBookingConfirmed = hasAnyValue(detail.bookingData)
  const isFunnelOnly = !isBookingConfirmed && hasAnyValue(detail.tripBrief)

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

      {isBookingConfirmed && detail.bookingData ? (
        <Card className="space-y-2 p-3">
          <Badge variant="success">Booking Ada</Badge>
          <dl className="space-y-1 text-sm">
            {detail.bookingData.destination && <Row label="Destinasi" value={detail.bookingData.destination} />}
            {detail.bookingData.dateRange && <Row label="Tanggal" value={detail.bookingData.dateRange} />}
            {detail.bookingData.pax != null && <Row label="Pax" value={String(detail.bookingData.pax)} />}
            {detail.bookingData.amountPaid != null && <Row label="Dibayar" value={formatIDR(detail.bookingData.amountPaid)} />}
            {detail.bookingData.amountDue != null && <Row label="Sisa" value={formatIDR(detail.bookingData.amountDue)} />}
            {detail.bookingData.status && <Row label="Status" value={detail.bookingData.status} />}
          </dl>
        </Card>
      ) : isFunnelOnly && detail.tripBrief ? (
        <Card className="space-y-2 p-3">
          <Badge variant="warning">Dari Funnel (belum booking)</Badge>
          <dl className="space-y-1 text-sm">
            {detail.tripBrief.destination && <Row label="Destinasi" value={detail.tripBrief.destination} />}
            {detail.tripBrief.dateRange && <Row label="Tanggal" value={detail.tripBrief.dateRange} />}
            {detail.tripBrief.pax != null && <Row label="Pax" value={String(detail.tripBrief.pax)} />}
          </dl>
        </Card>
      ) : (
        <Card className="p-3 text-sm text-muted-foreground">Belum ada data booking atau brief perjalanan.</Card>
      )}

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

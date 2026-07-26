import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { hasAnyValue, formatIDR } from '@/lib/contact-format'

export type BookingData = {
  destination?: string
  dateRange?: string
  pax?: number
  amountPaid?: number
  amountDue?: number
  status?: string
} | null

export type TripBrief = {
  destination?: string
  dateRange?: string
  pax?: number
} | null

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium text-navy">{value}</dd>
    </div>
  )
}

// Shared by ContactPanel (per-conversation, inbox) and the contacts/[id] CRM detail page —
// both need to distinguish a verified booking (Mode 3) from a funnel-only lead (Mode 1/2) from
// a brand-new conversation with neither, and render the same summary card either way.
export function BookingSummary({ bookingData, tripBrief }: { bookingData: BookingData; tripBrief: TripBrief }) {
  const isBookingConfirmed = hasAnyValue(bookingData)
  const isFunnelOnly = !isBookingConfirmed && hasAnyValue(tripBrief)

  if (isBookingConfirmed && bookingData) {
    return (
      <Card className="space-y-2 p-3">
        <Badge variant="success">Booking Ada</Badge>
        <dl className="space-y-1 text-sm">
          {bookingData.destination && <Row label="Destinasi" value={bookingData.destination} />}
          {bookingData.dateRange && <Row label="Tanggal" value={bookingData.dateRange} />}
          {bookingData.pax != null && <Row label="Pax" value={String(bookingData.pax)} />}
          {bookingData.amountPaid != null && <Row label="Dibayar" value={formatIDR(bookingData.amountPaid)} />}
          {bookingData.amountDue != null && <Row label="Sisa" value={formatIDR(bookingData.amountDue)} />}
          {bookingData.status && <Row label="Status" value={bookingData.status} />}
        </dl>
      </Card>
    )
  }

  if (isFunnelOnly && tripBrief) {
    return (
      <Card className="space-y-2 p-3">
        <Badge variant="warning">Dari Funnel (belum booking)</Badge>
        <dl className="space-y-1 text-sm">
          {tripBrief.destination && <Row label="Destinasi" value={tripBrief.destination} />}
          {tripBrief.dateRange && <Row label="Tanggal" value={tripBrief.dateRange} />}
          {tripBrief.pax != null && <Row label="Pax" value={String(tripBrief.pax)} />}
        </dl>
      </Card>
    )
  }

  return <Card className="p-3 text-sm text-muted-foreground">Belum ada data booking atau brief perjalanan.</Card>
}

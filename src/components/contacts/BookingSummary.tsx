import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { hasAnyValue, formatIDR } from '@/lib/contact-format'
import type { BookingData, BookingDate } from '@/lib/booking/client'

// The booking shape is owned by the API client, which passes the upstream JVTO
// payload straight through without remapping. This component used to declare its
// own guessed shape (destination/dateRange/pax/amountPaid/amountDue/status) — none
// of those keys exist on a real booking, so every genuine "Booking Ada" card
// rendered with an empty detail list. Re-export the real type so the two consumers
// (ContactPanel, contacts/[id]) keep importing it from here.
export type { BookingData }

// tripBrief is a different thing: it is the bot funnel's own collected brief
// (src/lib/bot/funnel.ts), not booking-API data, and this IS its real shape.
export type TripBrief = {
  destination?: string
  dateRange?: string
  pax?: number
} | null

// Stacked (label above value), not side-by-side: a booking's real values -- a full
// pickup address, a long package name -- routinely run well past what fits next to a
// label on one line, and squeezing them into `justify-between` wrapped the value
// awkwardly under/against the label instead of using the card's full width.
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="wrap-break-word font-medium text-navy">{value}</dd>
    </div>
  )
}

// The API returns both a human-readable range ("01 Aug 2026") and a sortable one
// ("2026-08-01"); prefer the human one, fall back to the ymd variant, and tolerate
// a booking with only a start date.
function formatBookingDate(date: BookingDate | undefined): string | null {
  if (!date) return null
  const start = date.start ?? date.start_ymd
  const end = date.end ?? date.end_ymd
  if (!start) return end ?? null
  return end && end !== start ? `${start} – ${end}` : start
}

// The real payload has no top-level `status` field. `financial.balance` is the
// operationally meaningful equivalent an agent actually acts on — a zero balance
// is a fully-paid booking ("Lunas", matching the pipeline stage of the same name),
// anything outstanding is not. With no financial block there is nothing to derive,
// so the row is omitted rather than guessed.
function derivePaymentStatus(balance: number | undefined): string | null {
  if (balance == null) return null
  return balance <= 0 ? 'Lunas' : 'Belum lunas'
}

// Shared by ContactPanel (per-conversation, inbox) and the contacts/[id] CRM detail page —
// both need to distinguish a verified booking (Mode 3) from a funnel-only lead (Mode 1/2) from
// a brand-new conversation with neither, and render the same summary card either way.
export function BookingSummary({
  bookingData,
  tripBrief,
}: {
  bookingData: BookingData | null
  tripBrief: TripBrief
}) {
  const isBookingConfirmed = hasAnyValue(bookingData)
  const isFunnelOnly = !isBookingConfirmed && hasAnyValue(tripBrief)

  if (isBookingConfirmed && bookingData) {
    const dateRange = formatBookingDate(bookingData.date)
    const payment = bookingData.financial?.payment
    const balance = bookingData.financial?.balance
    const paymentStatus = derivePaymentStatus(balance)
    const invoiceLink = bookingData.financial?.invoice?.invoiceLink?.[0]
    const itinerary = bookingData.itinerary ?? []

    return (
      <Card className="space-y-2 p-3">
        <Badge variant="success">Booking Ada</Badge>
        <dl className="space-y-1 text-sm">
          {bookingData.package && <Row label="Paket" value={bookingData.package} />}
          {dateRange && <Row label="Tanggal" value={dateRange} />}
          {bookingData.total_pax != null && <Row label="Pax" value={String(bookingData.total_pax)} />}
          {bookingData.pickup?.text && <Row label="Jemput" value={bookingData.pickup.text.trim()} />}
          {bookingData.dropoff?.text && <Row label="Antar" value={bookingData.dropoff.text.trim()} />}
          {payment != null && <Row label="Dibayar" value={formatIDR(payment)} />}
          {balance != null && <Row label="Sisa" value={formatIDR(balance)} />}
          {paymentStatus && <Row label="Status" value={paymentStatus} />}
        </dl>
        {itinerary.length > 0 && (
          <div className="space-y-1 border-t border-border pt-2">
            <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Itinerary</h4>
            <ol className="space-y-0.5 text-sm">
              {itinerary.map((day, i) => (
                <li key={i} className="flex gap-2">
                  <span className="shrink-0 text-muted-foreground">Hari {day.day ?? i + 1}</span>
                  <span className="min-w-0 wrap-break-word text-navy">{day.activity ?? day.itinerary ?? day.destination ?? '-'}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
        {invoiceLink && (
          <a
            href={invoiceLink}
            target="_blank"
            rel="noreferrer"
            className="block border-t border-border pt-2 text-sm text-brand underline"
          >
            Lihat Invoice
          </a>
        )}
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

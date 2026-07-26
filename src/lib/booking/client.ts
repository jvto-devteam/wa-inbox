// Ported from chatbot-web's src/bookingApiClient.js (lookupByPhone) — the
// proven, currently-live booking-lookup client for the JVTO booking API.
//
// Important: the real bookingApiClient.js does NOT map/flatten the API
// response into a curated set of fields — it returns the raw JSON object
// straight through (see `data` in its return value). Downstream chatbot-web
// code (components/BookingDetailModal.tsx, src/chatbot.js, src/faqPrompt.js,
// app/api/conversations/route.ts) reads fields like `guest`, `package`,
// `date.{start,end,start_ymd,end_ymd,days}`, `orderChannel`,
// `customer_portal`, `total_pax`, `duration`, `financial.{payment,balance}`,
// `guestDetails.{email,country,phone,trip_media}`, `pickup`, `dropoff`,
// `itinerary`, `hotels`, `guides`, `drivers` directly off that raw object —
// there is no `booking_id`/`destination`/`pax`/`amount_paid`/`amount_due`/
// `status` shape anywhere in the real system. BookingData below documents
// the fields actually observed in use, but keeps an index signature since
// the upstream API is not formally specified and can carry more fields
// depending on channel (JVTO vs KLOOK, etc).

export type BookingDate = {
  start?: string
  end?: string
  start_ymd?: string
  end_ymd?: string
  days?: string | number
}

export type BookingData = {
  id?: string
  guest?: string
  package?: string
  date?: BookingDate
  orderChannel?: string
  customer_portal?: string
  total_pax?: number
  duration?: string
  booking_date?: string
  financial?: { payment?: number; balance?: number }
  guestDetails?: { email?: string; country?: string; phone?: string; trip_media?: string }
  pickup?: Record<string, unknown>
  dropoff?: Record<string, unknown>
  itinerary?: Array<Record<string, unknown>>
  hotels?: Array<Record<string, unknown>>
  guides?: Array<Record<string, unknown>>
  drivers?: Array<Record<string, unknown>>
  [key: string]: unknown
}

// Strip everything except digits and '+' (spaces, dashes, parens) — matches
// bookingApiClient.js's normalization exactly.
function normalizePhone(phone: string): string {
  return String(phone ?? '').replace(/[^\d+]/g, '')
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

// Date range: from the 1st of last month onwards (the real API has no upper
// bound, so a far-future date is used). Built from local calendar date
// components, not `toISOString()` (which applies a UTC offset and could
// shift the day near local midnight, and wouldn't force day "01") — matches
// bookingApiClient.js exactly.
function buildDateRange(): string {
  const now = new Date()
  const from = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  return `${from.getFullYear()}-${pad(from.getMonth() + 1)}-01_2099-12-31`
}

// Pick the booking with the most recent `date.start_ymd` (string comparison,
// same as the real source — YYYY-MM-DD sorts correctly lexicographically).
// Missing/malformed `date` fields are tolerated rather than throwing.
function pickLatest(bookings: BookingData[]): BookingData | null {
  if (bookings.length === 0) return null
  const sorted = [...bookings].sort((a, b) => {
    const aDate = a?.date?.start_ymd || ''
    const bDate = b?.date?.start_ymd || ''
    return bDate.localeCompare(aDate)
  })
  return sorted[0]
}

/**
 * Looks up booking data for a phone number via the configured booking API.
 * Returns the raw booking object (most recent by start date, if multiple
 * bookings exist) or `null` when not found, not configured, or on any
 * error — never throws.
 */
export async function lookupBooking(phone: string): Promise<BookingData | null> {
  const url = process.env.BOOKING_API_URL
  if (!url) return null

  const key = process.env.BOOKING_API_KEY
  const headers: Record<string, string> = {}
  if (key) headers.Authorization = `Bearer ${key}`

  try {
    const normalized = normalizePhone(phone)
    // Keep '+' as a literal character — encodeURIComponent turns it into
    // %2B, which the JVTO server doesn't match.
    const encodedPhone = encodeURIComponent(normalized).replace(/%2B/g, '+')
    const dateRange = buildDateRange()
    const separator = url.includes('?') ? '&' : '?'

    const res = await fetch(`${url}${separator}filter_type=range&date_range=${dateRange}&phone_no=${encodedPhone}`, {
      headers,
      signal: AbortSignal.timeout(10000),
    })

    if (!res.ok) return null

    const body = await res.json()

    if (Array.isArray(body)) {
      return pickLatest(body as BookingData[])
    }

    if (!body || typeof body !== 'object' || Object.keys(body).length === 0) {
      return null
    }

    return body as BookingData
  } catch {
    return null
  }
}

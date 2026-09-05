/**
 * Strips secrets and shrinks bulky personal data out of a bot decision before it is stored or
 * shown. Guidebook §24 (Risiko 3) requires this; the sanitizer runs at RECORD time, not render
 * time, so a secret never lands in the database in the first place rather than merely being
 * hidden by whichever component happens to render it.
 *
 * Nothing in `src/lib/bot/orchestrator.ts` deliberately puts a token into a decision today.
 * That is exactly why this exists: the trace is assembled from free-form strings by a dozen
 * collaborators, it is a JSON column with no schema, and the first time something does leak in
 * there, it will be silently permanent and visible to every agent. A redactor that finds
 * nothing is the expected result.
 */

export type JsonLike = string | number | boolean | null | JsonLike[] | { [key: string]: JsonLike }

export const REDACTED = '[REDACTED]'

/**
 * Key names whose VALUE is never safe to keep, matched case-insensitively as a substring so
 * `accessToken`, `META_APP_SECRET` and `coexistApiKey` all match.
 */
const SECRET_KEY_HINTS = [
  'token',
  'secret',
  'password',
  'passwordhash',
  'apikey',
  'api_key',
  'authorization',
  'credential',
  'privatekey',
  'private_key',
  'signature',
  'cookie',
  'sessionid',
  'bearer',
]

/**
 * Booking fields worth keeping in a trace. Guidebook §12: booking data may appear, but only in
 * summary. An agent needs to know WHICH booking drove the answer, not the customer's full
 * itinerary, payment record and hotel address duplicated into every audit row.
 */
const BOOKING_SUMMARY_FIELDS = ['bookingCode', 'booking_code', 'orderChannel', 'status', 'packageKey', 'package_key', 'startDate', 'start_date', 'paxCount', 'pax']

/** Keys whose value is a booking blob rather than a scalar. */
const BOOKING_KEY_HINTS = ['bookingdata', 'booking_data', 'booking']

/** Long free text is truncated so one runaway field cannot bloat every audit row. */
const MAX_STRING_LENGTH = 2000

function isRecord(value: JsonLike): value is { [key: string]: JsonLike } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSecretKey(key: string): boolean {
  const lowered = key.toLowerCase()
  return SECRET_KEY_HINTS.some((hint) => lowered.includes(hint))
}

function isBookingKey(key: string): boolean {
  const lowered = key.toLowerCase()
  return BOOKING_KEY_HINTS.some((hint) => lowered.includes(hint))
}

/**
 * Reduces a booking object to the handful of identifying fields listed above.
 *
 * Fields are kept by name rather than dropped by name on purpose: an allowlist stays correct
 * when the booking API adds a field, whereas a denylist would silently start leaking it.
 */
function summarizeBooking(value: JsonLike): JsonLike {
  if (!isRecord(value)) return sanitizeValue(value)

  const summary: { [key: string]: JsonLike } = {}
  for (const field of BOOKING_SUMMARY_FIELDS) {
    if (field in value) summary[field] = sanitizeValue(value[field])
  }
  // Says what was left out, so a reader does not mistake the summary for the whole booking.
  const omitted = Object.keys(value).filter((key) => !(key in summary))
  if (omitted.length > 0) summary._ringkasan = `${omitted.length} field lain disembunyikan`
  return summary
}

function sanitizeValue(value: JsonLike): JsonLike {
  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}…` : value
  }
  if (Array.isArray(value)) return value.map(sanitizeValue)
  if (isRecord(value)) {
    const out: { [key: string]: JsonLike } = {}
    for (const key of Object.keys(value)) {
      if (isSecretKey(key)) {
        out[key] = REDACTED
        continue
      }
      if (isBookingKey(key)) {
        out[key] = summarizeBooking(value[key])
        continue
      }
      out[key] = sanitizeValue(value[key])
    }
    return out
  }
  return value
}

/**
 * Entry point. Accepts `unknown` because a BotDecision arrives from the orchestrator typed as
 * a union that callers pass around loosely; anything that is not JSON-representable (a
 * function, a Symbol, a circular object) is replaced with a note rather than throwing, since
 * failing here must never take down a bot turn.
 */
export function sanitizeTrace(value: unknown): JsonLike {
  let plain: JsonLike
  try {
    // The round-trip both proves the value is serialisable and drops undefined/functions,
    // which Prisma's Json column would reject at write time.
    plain = JSON.parse(JSON.stringify(value ?? null)) as JsonLike
  } catch {
    return { _error: 'Trace tidak bisa diserialisasi' }
  }
  return sanitizeValue(plain)
}

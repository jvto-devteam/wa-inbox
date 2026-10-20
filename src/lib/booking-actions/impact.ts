/**
 * Dampak perubahan berat (travel_date, total_pax, hotel, pindah Surabaya<->Bali) untuk kartu TASK.
 * Dibaca dari API internal new-backoffice SAAT DITAMPILKAN dan tidak pernah disimpan.
 *
 * Bentuk respons (new-backoffice BookingsController + BookingPresenter::present):
 *   GET /internal-api/bookings/{idOrCode} -> objek booking di level atas:
 *     booking_id, booking_code, travel_date_start/end (Y-m-d), at_ijen (Y-m-d|null),
 *     crew[].{crew_id,name,...}, hotels[].{day,date,hotel_name}
 *   GET /internal-api/bookings?from&to&by=active&crew=<id|nama> -> { bookings: [booking...] }
 * Env kosong / HTTP non-OK / timeout / bentuk tak terduga -> unavailable. Tidak pernah melempar.
 * Token tidak pernah masuk log.
 */
import type { FieldKey } from '@/lib/booking-actions/fields'

export type Impact = {
  crewClashes: string[]
  hotelNights: string[]
  medicalCheckupDate: { from: string | null; to: string | null } | null
  unavailable?: true
}

const TIMEOUT_MS = 8000
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
const YMD = /^(\d{4})-(\d{2})-(\d{2})$/

class Unavailable extends Error {}

const UNAVAILABLE: Impact = { crewClashes: [], hotelNights: [], medicalCheckupDate: null, unavailable: true }

function unavailable(): Impact {
  return { ...UNAVAILABLE, crewClashes: [], hotelNights: [] }
}

function parseYmd(s: unknown): number | null {
  if (typeof s !== 'string') return null
  const m = YMD.exec(s)
  if (!m) return null
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  if (Number.isNaN(t)) return null
  return new Date(t).toISOString().slice(0, 10) === s ? t : null
}

function addDays(s: string | null, days: number): string | null {
  const t = s === null ? null : parseYmd(s)
  if (t === null) return null
  return new Date(t + days * 86400000).toISOString().slice(0, 10)
}

function dayMonth(s: string): string {
  const m = YMD.exec(s)
  if (!m) return s
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}`
}

function range(a: string, b: string): string {
  const ma = YMD.exec(a)
  const mb = YMD.exec(b)
  if (!ma || !mb || a === b) return dayMonth(a)
  if (ma[2] === mb[2]) return `${Number(ma[3])}–${dayMonth(b)}`
  return `${dayMonth(a)}–${dayMonth(b)}`
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null
}

async function get(base: string, token: string, path: string, signal: AbortSignal): Promise<unknown> {
  const res = await fetch(`${base}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal,
  })
  if (!res.ok) throw new Unavailable(`http ${res.status}`)
  return await res.json()
}

type Booking = {
  id: string
  code: string
  start: string | null
  end: string | null
  atIjen: string | null
  crew: Array<{ id: string | null; name: string | null }>
  hotels: Array<{ date: string | null; name: string }>
}

function parseBooking(raw: unknown): Booking {
  if (!isRecord(raw)) throw new Unavailable('shape')
  const idRaw = raw.booking_id
  if (typeof idRaw !== 'number' && typeof idRaw !== 'string') throw new Unavailable('shape')
  const crew = Array.isArray(raw.crew) ? raw.crew : []
  const hotels = Array.isArray(raw.hotels) ? raw.hotels : []
  return {
    id: String(idRaw),
    code: str(raw.booking_code) ?? `#${idRaw}`,
    start: str(raw.travel_date_start),
    end: str(raw.travel_date_end),
    atIjen: str(raw.at_ijen),
    crew: crew.filter(isRecord).map(c => ({
      id: typeof c.crew_id === 'number' || typeof c.crew_id === 'string' ? String(c.crew_id) : null,
      name: str(c.name),
    })),
    hotels: hotels.filter(isRecord).flatMap(h => {
      const name = str(h.hotel_name)
      return name ? [{ date: str(h.date), name }] : []
    }),
  }
}

async function compute(
  base: string,
  token: string,
  signal: AbortSignal,
  action: { field: FieldKey; proposedValue: unknown; bookingId: string },
): Promise<Impact> {
  const booking = parseBooking(await get(base, token, `/internal-api/bookings/${encodeURIComponent(action.bookingId)}`, signal))
  const impact: Impact = { crewClashes: [], hotelNights: [], medicalCheckupDate: null }

  if (action.field !== 'travel_date') {
    impact.hotelNights = booking.hotels.map(h => (h.date ? `${h.name}: ${dayMonth(h.date)}` : h.name))
    return impact
  }

  const newStart = typeof action.proposedValue === 'string' ? action.proposedValue : null
  const t1 = newStart === null ? null : parseYmd(newStart)
  const t0 = booking.start === null ? null : parseYmd(booking.start)
  if (newStart === null || t1 === null || t0 === null || booking.end === null) throw new Unavailable('dates')
  const delta = Math.round((t1 - t0) / 86400000)
  const newEnd = addDays(booking.end, delta)
  if (newEnd === null) throw new Unavailable('dates')

  impact.hotelNights = booking.hotels.flatMap(h => {
    const moved = addDays(h.date, delta)
    return h.date && moved ? [`${h.name}: ${dayMonth(h.date)} → ${dayMonth(moved)}`] : []
  })

  if (booking.atIjen !== null) {
    impact.medicalCheckupDate = { from: addDays(booking.atIjen, -1), to: addDays(booking.atIjen, delta - 1) }
  }

  const members = new Map<string, string | null>()
  for (const member of booking.crew) {
    const key = member.id ?? member.name
    if (key !== null && !members.has(key)) members.set(key, member.name)
  }

  const results = await Promise.all(
    [...members].map(async ([key, name]) => {
      const q = new URLSearchParams({ from: newStart, to: newEnd, by: 'active', crew: key })
      const body = await get(base, token, `/internal-api/bookings?${q.toString()}`, signal)
      if (!isRecord(body) || !Array.isArray(body.bookings)) throw new Unavailable('shape')
      const lines = new Map<string, string>()
      for (const other of body.bookings.filter(isRecord).map(parseBooking)) {
        if (other.id === booking.id || other.start === null || lines.has(other.id)) continue
        lines.set(
          other.id,
          `${name ?? `Crew ${key}`} bentrok dengan ${other.code} (${range(other.start, other.end ?? other.start)})`,
        )
      }
      return [...lines.values()]
    }),
  )
  impact.crewClashes = results.flat()
  return impact
}

export async function computeImpact(action: {
  field: FieldKey
  proposedValue: unknown
  bookingId: string
}): Promise<Impact> {
  const base = (process.env.BACKOFFICE_INTERNAL_API_URL ?? '').trim().replace(/\/+$/, '')
  const token = (process.env.BACKOFFICE_INTERNAL_API_TOKEN ?? '').trim()
  if (!base || !token) return unavailable()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    return await compute(base, token, controller.signal, action)
  } catch (err) {
    const reason = err instanceof Unavailable ? err.message : err instanceof Error ? err.name : 'error'
    console.warn(`[booking-actions/impact] unavailable: ${reason}`)
    return unavailable()
  } finally {
    clearTimeout(timer)
  }
}

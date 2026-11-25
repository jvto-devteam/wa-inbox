// Sinkron jadwal reminder WhatsApp cron LEGACY ke tabel AgentSchedule (tab "Jadwal agent" di Antrean /new).
// Sumber: new-backoffice `GET /wa-inbox-api/upcoming-reminders` (controller WaInboxApi\UpcomingRemindersController),
// alamat dan kredensial SAMA dengan jalur catatan crew: asal BOOKING_API_URL + header X-Internal-Token = BOOKING_API_KEY.
// Dipanggil tick 5 menit. Tidak pernah melempar; gagal = baris lama dibiarkan (halaman tetap menampilkan salinan terakhir).
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { jakartaDay } from '@/lib/bot/eval/replay-pairs'
import { crewNotesBaseUrl } from '@/lib/chat-review/crew-note-sync'
import { normalizePhoneNumber } from '@/lib/phone'
import { addDays } from '@/lib/new/report'

const REQUEST_TIMEOUT_MS = 15_000
/** Jendela: kemarin (melihat yang gagal/terlewat) sampai 7 hari ke depan. */
export const WINDOW_BACK_DAYS = 1
export const WINDOW_AHEAD_DAYS = 7
/** Baris yang jam kirimnya lebih tua dari ini dibuang. */
const KEEP_DAYS = 7

const itemSchema = z.object({
  key: z.string().min(1).max(200),
  kind: z.string().min(1).max(50),
  booking_id: z.number().int(),
  booking_code: z.string().nullable(),
  booking_status: z.string().nullable(),
  guest_name: z.string().nullable(),
  guest_phone: z.string().nullable(),
  recipient: z.string().min(1).max(100),
  send_at: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'send_at bukan waktu'),
  status: z.string().min(1).max(30),
})
const responseSchema = z.object({ items: z.array(itemSchema) })
export type UpcomingItem = z.infer<typeof itemSchema>

export type SyncResult =
  | { status: 'ok'; upserted: number }
  | { status: 'not_configured' }
  | { status: 'unavailable'; code: number | null }

function window(now: Date): { from: string; to: string } {
  const today = jakartaDay(now)
  return { from: addDays(today, -WINDOW_BACK_DAYS), to: addDays(today, WINDOW_AHEAD_DAYS) }
}

/** Awal hari WIB `from` dan akhir hari WIB `to` sebagai Date (batas hapus baris yang tidak lagi dikirim backoffice). */
function windowBounds(w: { from: string; to: string }): { start: Date; end: Date } {
  return { start: new Date(w.from + 'T00:00:00+07:00'), end: new Date(w.to + 'T23:59:59.999+07:00') }
}

export async function fetchUpcoming(now: Date): Promise<{ ok: true; items: UpcomingItem[] } | { ok: false; code: number | null }> {
  const base = crewNotesBaseUrl()
  const key = process.env.BOOKING_API_KEY?.trim()
  if (!base || !key) return { ok: false, code: null }
  const w = window(now)
  const res = await fetch(`${base}/wa-inbox-api/upcoming-reminders?from=${w.from}&to=${w.to}`, {
    headers: { accept: 'application/json', 'x-internal-token': key },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!res.ok) return { ok: false, code: res.status }
  const parsed = responseSchema.safeParse(await res.json().catch(() => null))
  return parsed.success ? { ok: true, items: parsed.data.items } : { ok: false, code: res.status }
}

/** Nomor tamu → percakapan WhatsApp terbaru di identitas WA nomor itu (satu kueri; kunci = ChannelIdentity, bukan Contact.phone). */
async function conversationsByPhone(phones: string[]): Promise<Map<string, string>> {
  if (!phones.length) return new Map()
  const identities = await prisma.channelIdentity.findMany({
    where: { platform: 'WHATSAPP', externalId: { in: phones } },
    select: { externalId: true, conversations: { select: { id: true }, orderBy: { lastMessageAt: 'desc' }, take: 1 } },
  })
  const out = new Map<string, string>()
  for (const i of identities) if (i.conversations[0]) out.set(i.externalId, i.conversations[0].id)
  return out
}

export async function syncAgentSchedule(now: Date = new Date()): Promise<SyncResult> {
  try {
    if (!crewNotesBaseUrl() || !process.env.BOOKING_API_KEY?.trim()) return { status: 'not_configured' }
    const got = await fetchUpcoming(now)
    if (!got.ok) return { status: 'unavailable', code: got.code }

    const phoneOf = new Map(got.items.map((i) => [i.key, i.guest_phone ? normalizePhoneNumber(i.guest_phone) : null]))
    const convs = await conversationsByPhone([...new Set([...phoneOf.values()].filter((p): p is string => !!p))])
    const { start, end } = windowBounds(window(now))
    const keys = got.items.map((i) => i.key)

    await prisma.$transaction([
      ...got.items.map((i) => {
        const phone = phoneOf.get(i.key) ?? null
        const data = {
          kind: i.kind,
          bookingId: i.booking_id,
          bookingCode: i.booking_code,
          bookingStatus: i.booking_status,
          guestName: i.guest_name,
          phoneTail: phone ? phone.slice(-4) : null,
          conversationId: phone ? convs.get(phone) ?? null : null,
          recipient: i.recipient,
          sendAt: new Date(i.send_at),
          status: i.status,
          refreshedAt: now,
        }
        return prisma.agentSchedule.upsert({ where: { key: i.key }, create: { key: i.key, ...data }, update: data })
      }),
      // Di dalam jendela tetapi tidak dikirim lagi = jadwalnya hilang (booking batal/diubah).
      prisma.agentSchedule.deleteMany({ where: { sendAt: { gte: start, lte: end }, key: { notIn: keys } } }),
      prisma.agentSchedule.deleteMany({ where: { sendAt: { lt: new Date(now.getTime() - KEEP_DAYS * 864e5) } } }),
    ])
    return { status: 'ok', upserted: got.items.length }
  } catch (error) {
    console.error('syncAgentSchedule gagal', error instanceof Error ? error.name : 'unknown')
    return { status: 'unavailable', code: null }
  }
}

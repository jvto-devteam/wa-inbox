import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateApiClient } from '@/lib/api-clients/auth'
import { prisma } from '@/lib/db'
import { buildSummaryDigest } from '@/lib/summaries/digest'

/**
 * GET /api/v1/summaries?date=YYYY-MM-DD — ringkasan harian tanpa data pribadi, untuk agen
 * Operator second brain JVTO (lihat src/lib/summaries/digest.ts untuk apa yang dibuang).
 *
 *   Authorization: Bearer wai_...
 *
 * Tanpa `date`: ringkasan terbaru yang sudah selesai (DONE atau PARTIAL). Ditambah `openItems`:
 * jumlah SummaryItem yang masih terbuka sekarang, per jenis dan status.
 *
 * Akses baca TIDAK otomatis ikut setiap API key: key pengirim pesan (javavolcano-touroperator,
 * new-backoffice) tidak butuh membaca ringkasan. Hanya ApiClient yang id-nya ada di
 * SUMMARIES_READ_CLIENT_IDS (dipisah koma) yang boleh; env kosong = endpoint mati (403).
 * Machine-to-machine: tanpa sesi. src/middleware.ts meloloskan path ini hanya bila ada Bearer key.
 */
const READ_CLIENTS_ENV = 'SUMMARIES_READ_CLIENT_IDS'

const querySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
})

function allowedClientIds(): Set<string> {
  return new Set(
    (process.env[READ_CLIENTS_ENV] ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  )
}

function bookingRefOf(bookingData: unknown): string | null {
  if (!bookingData || typeof bookingData !== 'object') return null
  const b = bookingData as Record<string, unknown>
  for (const key of ['booking_number', 'id'] as const) {
    const v = b[key]
    if (typeof v === 'string' && v.trim()) return v.trim()
    if (typeof v === 'number') return String(v)
  }
  return null
}

export async function GET(req: Request) {
  try {
    const client = await authenticateApiClient(req)
    if (!client) return NextResponse.json({ error: 'API key tidak valid' }, { status: 401 })
    if (!allowedClientIds().has(client.id)) {
      return NextResponse.json({ error: 'API key ini tidak punya akses baca ringkasan' }, { status: 403 })
    }

    const parsed = querySchema.safeParse({ date: new URL(req.url).searchParams.get('date') ?? undefined })
    if (!parsed.success) return NextResponse.json({ error: 'Parameter date harus berformat YYYY-MM-DD' }, { status: 400 })

    const row = parsed.data.date
      ? await prisma.dailySummary.findUnique({
          where: { date: parsed.data.date },
          select: { date: true, status: true, payload: true },
        })
      : await prisma.dailySummary.findFirst({
          where: { status: { in: ['DONE', 'PARTIAL'] } },
          orderBy: { date: 'desc' },
          select: { date: true, status: true, payload: true },
        })
    if (!row) return NextResponse.json({ error: 'Ringkasan untuk tanggal itu tidak ada' }, { status: 404 })
    if (row.status !== 'DONE' && row.status !== 'PARTIAL') {
      return NextResponse.json({ error: `Ringkasan tanggal ${row.date} belum selesai (${row.status})` }, { status: 409 })
    }

    const ids = new Set<string>()
    const payloadConversations = (row.payload as { conversations?: { conversationId?: unknown }[] } | null)?.conversations
    for (const c of payloadConversations ?? []) if (typeof c.conversationId === 'string') ids.add(c.conversationId)
    const conversations = ids.size
      ? await prisma.conversation.findMany({ where: { id: { in: [...ids] } }, select: { id: true, bookingData: true } })
      : []
    const bookingRefs = new Map<string, string>()
    for (const c of conversations) {
      const ref = bookingRefOf(c.bookingData)
      if (ref) bookingRefs.set(c.id, ref)
    }

    const digest = buildSummaryDigest(row, bookingRefs)
    if (!digest) return NextResponse.json({ error: `Format ringkasan tanggal ${row.date} tidak dikenali` }, { status: 422 })

    const open = await prisma.summaryItem.groupBy({
      by: ['kind', 'state'],
      where: { state: { in: ['OPEN', 'SCHEDULED'] } },
      _count: { _all: true },
    })
    const openItems = open.map((g) => ({ kind: g.kind, state: g.state, count: g._count._all }))

    return NextResponse.json({ ...digest, openItems })
  } catch (error) {
    console.error('GET /api/v1/summaries gagal', error)
    return NextResponse.json({ error: 'Gagal membaca ringkasan' }, { status: 500 })
  }
}

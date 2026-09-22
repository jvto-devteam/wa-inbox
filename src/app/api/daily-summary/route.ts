import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'
import { dailySummaryPayloadSchema, type DailySummaryPayload } from '@/lib/daily-summary/payload-schema'
import { isDateKey } from '@/lib/daily-summary/time'

/**
 * GET /api/daily-summary?date=YYYY-MM-DD — ringkasan satu hari untuk halaman /summary, plus
 * daftar tanggal yang tersedia. Tanpa `date` = tanggal terbaru yang ada.
 *
 * Terbuka untuk semua yang login: isinya percakapan yang sama yang sudah bisa dibaca setiap
 * agen di Inbox. Membuat ulang (POST .../generate) tetap hanya admin.
 */

export type DailySummaryListEntry = { date: string; status: string }

export type DailySummaryView = {
  date: string
  status: string
  model: string | null
  startedAt: string
  finishedAt: string | null
  error: string | null
  payload: DailySummaryPayload | null
}

export type DailySummaryResponse = { dates: DailySummaryListEntry[]; summary: DailySummaryView | null }

export async function GET(req: Request) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 })

  const requested = new URL(req.url).searchParams.get('date')
  if (requested !== null && !isDateKey(requested)) {
    return NextResponse.json({ error: 'Format tanggal harus YYYY-MM-DD' }, { status: 400 })
  }

  try {
    const dates = await prisma.dailySummary.findMany({ orderBy: { date: 'desc' }, take: 31, select: { date: true, status: true } })
    const date = requested ?? dates[0]?.date
    const row = date ? await prisma.dailySummary.findUnique({ where: { date } }) : null

    let summary: DailySummaryView | null = null
    if (row) {
      const parsed = row.payload === null ? null : dailySummaryPayloadSchema.safeParse(row.payload)
      summary = {
        date: row.date,
        status: row.status,
        model: row.model,
        startedAt: row.startedAt.toISOString(),
        finishedAt: row.finishedAt?.toISOString() ?? null,
        error: parsed && !parsed.success ? 'Format ringkasan tersimpan tidak dikenali. Buat ulang ringkasan ini.' : row.error,
        payload: parsed?.success ? parsed.data : null,
      }
    }

    return NextResponse.json({ dates, summary } satisfies DailySummaryResponse)
  } catch (error) {
    console.error('GET /api/daily-summary gagal', error)
    return NextResponse.json({ error: 'Gagal memuat ringkasan' }, { status: 500 })
  }
}

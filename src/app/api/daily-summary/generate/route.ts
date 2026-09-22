import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/auth/require-admin'
import { hasValidCronSecret } from '@/lib/outbound/cron-auth'
import { generateDailySummary, oldestRetainedDateKey } from '@/lib/daily-summary/generate'
import { isDateKey, jakartaDayKey, previousJakartaDayKey } from '@/lib/daily-summary/time'

/**
 * POST /api/daily-summary/generate — buat (ulang) ringkasan chat satu hari WIB.
 *
 * Dua pemanggil: crontab VPS tiap 00:00 WIB (`0 17 * * *` UTC) dengan header `x-cron-secret`,
 * dan admin yang menekan "Buat ulang" di /summary. Secret dicek ulang di sini, bukan hanya di
 * middleware -- alasan yang sama dengan POST /api/outbound-jobs/process.
 *
 * Tanpa body = hari WIB kemarin. Hari ini dan masa depan ditolak (harinya belum selesai), begitu
 * juga hari yang sudah lewat masa retensi 30 hari (akan langsung terpangkas).
 *
 * Sinkron: job-nya beberapa menit (satu panggilan LLM per percakapan). Server ini self-host
 * Node tanpa batas durasi handler; crontab memanggilnya dengan `curl --max-time`.
 */

const bodySchema = z.object({ date: z.string().refine(isDateKey, 'Format tanggal harus YYYY-MM-DD').optional() }).strict()

async function readBody(req: Request): Promise<unknown> {
  const text = await req.text()
  if (!text.trim()) return {}
  return JSON.parse(text)
}

export async function POST(req: Request) {
  const authorized = hasValidCronSecret(req) || (await requireAdmin(req)) !== null
  if (!authorized) {
    return NextResponse.json({ error: 'Hanya admin atau scheduler yang bisa membuat ringkasan' }, { status: 403 })
  }

  let body: z.infer<typeof bodySchema>
  try {
    const parsed = bodySchema.safeParse(await readBody(req))
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Body tidak valid' }, { status: 400 })
    body = parsed.data
  } catch {
    return NextResponse.json({ error: 'Body harus JSON' }, { status: 400 })
  }

  const now = new Date()
  const date = body.date ?? previousJakartaDayKey(now)
  if (date >= jakartaDayKey(now)) {
    return NextResponse.json({ error: 'Hari itu belum selesai' }, { status: 400 })
  }
  if (date < oldestRetainedDateKey(now)) {
    return NextResponse.json({ error: 'Tanggal itu sudah lewat masa simpan 30 hari' }, { status: 400 })
  }

  try {
    const result = await generateDailySummary(date, now)
    if (result.outcome === 'already_running') {
      return NextResponse.json({ error: 'Ringkasan tanggal ini sedang dibuat' }, { status: 409 })
    }
    if (result.outcome === 'failed') {
      return NextResponse.json({ error: 'Gagal membuat ringkasan' }, { status: 500 })
    }
    return NextResponse.json({ date: result.date, status: result.status })
  } catch (error) {
    console.error('POST /api/daily-summary/generate gagal', error)
    return NextResponse.json({ error: 'Gagal membuat ringkasan' }, { status: 500 })
  }
}

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'

/**
 * GET /api/dashboard/activity?days=7|14|30 — semua yang punya sumbu waktu, dalam satu bacaan.
 *
 * Tiga pertanyaan yang rentangnya sama, jadi satu round-trip dan satu tombol rentang di UI:
 *   - Berapa banyak percakapan yang benar-benar terjadi? (Message)
 *   - Bot masih menjawab, atau makin sering menyerah? (BotDecisionRun)
 *   - Apa yang tidak bisa dijawabnya? (KnowledgeGapLog)
 *
 * TIDAK ADA baris mentah yang menyeberang. Produksi punya 8.637 Message dan tabel itu hanya
 * pernah tumbuh; menariknya lalu menghitung di JS akan lambat hari ini dan tidak mungkin tahun
 * depan. Semuanya `groupBy`/`aggregate`/`count`, plus satu $queryRaw untuk ember harian karena
 * Prisma tidak bisa groupBy hasil `date_trunc` — dan raw itu pun mengembalikan paling banyak
 * hari × 2 baris (60), bukan pesannya.
 *
 * ZONA WAKTU. VPS berjalan UTC, tim membaca Asia/Jakarta. "Hari" di grafik ini adalah hari
 * Jakarta, dipotong di database dengan `AT TIME ZONE 'Asia/Jakarta'`. Memakai hari UTC akan
 * memindahkan tujuh jam pertama tiap pagi ke kolom kemarin — sepenuhnya tidak terlihat di
 * grafik dan sepenuhnya salah.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Rentang yang boleh diminta. Daftar tertutup, bukan angka bebas: nilainya menentukan berapa
 * banyak kolom digambar dan seberapa jauh ke belakang tabel Message dipindai, dan `?days=100000`
 * dari luar tidak boleh bisa mengubah keduanya.
 */
export const ALLOWED_DAYS = [7, 14, 30] as const
const daysSchema = z.coerce.number().int().refine((n): n is (typeof ALLOWED_DAYS)[number] => (ALLOWED_DAYS as readonly number[]).includes(n))

export type DashboardActivity = {
  days: number
  since: string
  decisions: {
    total: number
    byStatus: Record<string, number>
    flagged: number
    avgLatencyMs: number | null
    maxLatencyMs: number | null
  }
  volume: { day: string; inbound: number; outbound: number }[]
  gaps: {
    total: number
    byReason: Record<string, number>
    topTopics: { topic: string; count: number }[]
  }
}

/** "YYYY-MM-DD" pada kalender Jakarta, apa pun zona mesin yang menjalankannya. */
function jakartaDayKey(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at)
}

/**
 * Daftar hari Jakarta yang RAPAT, berakhir hari ini. Sengaja dibangun di sini dan bukan
 * diturunkan dari baris yang kembali: hari tanpa satu pesan pun tidak muncul di hasil GROUP BY,
 * dan grafik yang melompati hari sepi menggambar garis naik yang tidak pernah terjadi.
 *
 * Jakarta tidak punya DST, jadi menambah 24 jam selalu memindahkan tepat satu hari kalender.
 */
function jakartaDayRange(days: number): string[] {
  const startOfToday = new Date(`${jakartaDayKey(new Date())}T00:00:00+07:00`)
  const keys: string[] = []
  for (let i = days - 1; i >= 0; i--) keys.push(jakartaDayKey(new Date(startOfToday.getTime() - i * MS_PER_DAY)))
  return keys
}

export async function GET(req: Request) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = daysSchema.safeParse(new URL(req.url).searchParams.get('days') ?? ALLOWED_DAYS[0])
  if (!parsed.success) {
    return NextResponse.json({ error: `days harus salah satu dari ${ALLOWED_DAYS.join(', ')}` }, { status: 400 })
  }
  const days = parsed.data

  try {
    const dayKeys = jakartaDayRange(days)
    // Awal hari Jakarta paling awal, dinyatakan sebagai instan UTC — batas yang sama dipakai
    // ketiga bagian, sehingga "30 hari" berarti hal yang persis sama di grafik dan di angkanya.
    const since = new Date(`${dayKeys[0]}T00:00:00+07:00`)

    const [statusGroups, latency, flagged, volumeRows, reasonGroups, topicGroups] = await Promise.all([
      prisma.botDecisionRun.groupBy({
        by: ['status'],
        where: { startedAt: { gte: since } },
        _count: { _all: true },
      }),
      prisma.botDecisionRun.aggregate({
        where: { startedAt: { gte: since }, latencyMs: { not: null } },
        _avg: { latencyMs: true },
        _max: { latencyMs: true },
      }),
      prisma.botDecisionRun.count({ where: { startedAt: { gte: since }, flaggedAt: { not: null } } }),
      // COUNT(*)::int, bukan COUNT(*): tanpa cast Postgres mengembalikan bigint, yang berubah
      // jadi BigInt di JS dan membuat JSON.stringify melempar saat response diserialkan.
      prisma.$queryRaw<Array<{ day: string; direction: string; count: number }>>`
        SELECT to_char(date_trunc('day', "createdAt" AT TIME ZONE 'Asia/Jakarta'), 'YYYY-MM-DD') AS day,
               "direction"::text AS direction,
               COUNT(*)::int AS count
        FROM "Message"
        WHERE "createdAt" >= ${since}
        GROUP BY 1, 2
      `,
      prisma.knowledgeGapLog.groupBy({
        by: ['reason'],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
      }),
      // Enam teratas dipilih dan diurutkan DI DATABASE. Mengambil semua gap lalu menghitung
      // topik di JS adalah pola yang persis dilarang di sini.
      prisma.knowledgeGapLog.groupBy({
        by: ['topic'],
        where: { createdAt: { gte: since } },
        _count: { topic: true },
        orderBy: { _count: { topic: 'desc' } },
        take: 6,
      }),
    ])

    const byStatus: Record<string, number> = {}
    for (const g of statusGroups) byStatus[g.status] = g._count._all

    const byReason: Record<string, number> = {}
    for (const g of reasonGroups) byReason[g.reason] = g._count._all

    const inbound = new Map<string, number>()
    const outbound = new Map<string, number>()
    for (const row of volumeRows) {
      ;(row.direction === 'INBOUND' ? inbound : outbound).set(row.day, Number(row.count))
    }

    const body: DashboardActivity = {
      days,
      since: since.toISOString(),
      decisions: {
        total: statusGroups.reduce((sum, g) => sum + g._count._all, 0),
        byStatus,
        flagged,
        avgLatencyMs: latency._avg.latencyMs === null ? null : Math.round(latency._avg.latencyMs),
        maxLatencyMs: latency._max.latencyMs ?? null,
      },
      volume: dayKeys.map((day) => ({
        day,
        inbound: inbound.get(day) ?? 0,
        outbound: outbound.get(day) ?? 0,
      })),
      gaps: {
        total: reasonGroups.reduce((sum, g) => sum + g._count._all, 0),
        byReason,
        topTopics: topicGroups.map((g) => ({ topic: g.topic, count: g._count.topic })),
      },
    }

    return NextResponse.json(body)
  } catch {
    return NextResponse.json({ error: 'Gagal membaca aktivitas' }, { status: 500 })
  }
}

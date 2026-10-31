import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'

/**
 * GET /api/dashboard/activity?days=7|14|30 — semua yang punya sumbu waktu, dalam satu bacaan.
 *
 * Bot masih menjawab, atau makin sering menyerah? (BotDecisionRun), keseluruhan dan per
 * cluster topik/job. Satu round-trip, satu tombol rentang di UI.
 *
 * TIDAK ADA baris mentah yang menyeberang: semuanya `groupBy`/`aggregate`/`count`.
 *
 * ZONA WAKTU. Rentangnya dihitung dari awal hari Asia/Jakarta, bukan hari UTC.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Rentang yang boleh diminta. Daftar tertutup, bukan angka bebas: nilainya menentukan berapa
 * jauh ke belakang tabel BotDecisionRun dipindai, dan `?days=100000` dari luar tidak boleh bisa
 * mengubahnya.
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
  byTopic: ClusterRow<'topic'>[]
  byJob: ClusterRow<'job'>[]
}

/** Satu baris cluster: hitungan total dan tiga hasil yang dibedakan, kunci `topic` atau `job`. */
type ClusterRow<K extends string> = Record<K, string> & {
  total: number
  replied: number
  clarified: number
  handoff: number
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

/** Awal hari Jakarta paling awal dalam rentang. Jakarta tidak punya DST, jadi tiap hari tepat 24 jam. */
function jakartaRangeStart(days: number): Date {
  const startOfToday = new Date(`${jakartaDayKey(new Date())}T00:00:00+07:00`)
  return new Date(startOfToday.getTime() - (days - 1) * MS_PER_DAY)
}

/**
 * `byTopic` dan `byJob` (Ruling R53): satu baris per cluster, dari `groupBy(['topic'|'job',
 * 'status'])` yang baris-barisnya terpecah per status. `total` menjumlahkan SEMUA status yang
 * ditulis untuk cluster itu (termasuk FAILED/SKIPPED), bukan hanya tiga yang ditampilkan --
 * kalau tidak, jumlah baris tidak akan cocok dengan "berapa banyak keputusan" yang sebenarnya
 * terjadi untuk cluster itu. Diurutkan total menurun, DI SINI: baris sudah sedikit (jumlah
 * cluster yang berbeda), jadi mengurutkan di JS tidak melanggar aturan "urutkan di database".
 */
function shapeClusters<K extends string>(
  rows: (Record<K, string | null> & { status: string; _count: { _all: number } })[],
  key: K
): ClusterRow<K>[] {
  const byKey = new Map<string, ClusterRow<K>>()
  for (const row of rows) {
    const value = row[key]
    if (value === null) continue
    const existing = byKey.get(value) ?? ({ [key]: value, total: 0, replied: 0, clarified: 0, handoff: 0 } as ClusterRow<K>)
    existing.total += row._count._all
    if (row.status === 'REPLIED') existing.replied += row._count._all
    else if (row.status === 'CLARIFIED') existing.clarified += row._count._all
    else if (row.status === 'HANDOFF') existing.handoff += row._count._all
    byKey.set(value, existing)
  }
  return Array.from(byKey.values()).sort((a, b) => b.total - a.total)
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
    const since = jakartaRangeStart(days)

    const [statusGroups, latency, flagged, topicStatusGroups, jobStatusGroups] = await Promise.all([
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
      // R53: dua sumbu klasifikasi giliran BotDecisionRun (lihat komentar `topic`/`job` di
      // schema) -- sama persis dengan groupBy status di atas, hanya sumbunya ditambah satu.
      prisma.botDecisionRun.groupBy({
        by: ['topic', 'status'],
        where: { startedAt: { gte: since }, topic: { not: null } },
        _count: { _all: true },
      }),
      prisma.botDecisionRun.groupBy({
        by: ['job', 'status'],
        where: { startedAt: { gte: since }, job: { not: null } },
        _count: { _all: true },
      }),
    ])

    const byStatus: Record<string, number> = {}
    for (const g of statusGroups) byStatus[g.status] = g._count._all

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
      byTopic: shapeClusters(topicStatusGroups, 'topic'),
      byJob: shapeClusters(jobStatusGroups, 'job'),
    }

    return NextResponse.json(body)
  } catch {
    return NextResponse.json({ error: 'Gagal membaca aktivitas' }, { status: 500 })
  }
}

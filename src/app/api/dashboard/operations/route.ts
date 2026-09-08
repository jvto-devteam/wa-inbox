import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'
import { stuckOutboundJobWhere } from '@/lib/outbound/stuck'
import { PIPELINE_STAGES } from '@/lib/pipeline'

/**
 * GET /api/dashboard/operations — keadaan SEKARANG, bukan rentang waktu.
 *
 * Dua hal di sini dan keduanya adalah potret, bukan tren, karena datanya memang tidak punya
 * sumbu waktu: `Conversation.pipelineStage` hanya menyimpan tahap yang berlaku hari ini (tidak
 * ada riwayat perpindahan tahap di mana pun di skema), dan antrean outbound menurut definisinya
 * adalah apa yang tertahan pada detik ini. Karena itu route ini TIDAK menerima `?days=` —
 * memberinya rentang berarti menjanjikan potongan waktu yang tidak bisa dijawab datanya.
 * Yang berbasis rentang tinggal di /api/dashboard/activity.
 *
 * SEMUA agregasi dikerjakan database. `groupBy` mengembalikan satu baris per tahap (5) dan satu
 * baris per status job (paling banyak 3 di sini) — bukan 339 percakapan dan ribuan job yang
 * ditarik lalu dihitung di JS.
 */

/** Status job yang benar-benar masih bergerak. SENT/CANCELLED sudah selesai dan tidak ditunggu. */
const IN_FLIGHT_STATUSES = ['QUEUED', 'SENDING', 'RETRYING'] as const

/**
 * Jendela "gagal baru-baru ini". FAILED sepanjang masa adalah angka arsip yang tidak menuntut
 * apa pun hari ini; yang menuntut tindakan adalah kegagalan yang masih hangat.
 */
const RECENT_FAILURE_MS = 24 * 60 * 60 * 1000

export type DashboardOperations = {
  funnel: { stage: string; label: string; count: number }[]
  conversationTotal: number
  outbound: {
    inFlight: Record<string, number>
    inFlightTotal: number
    failedRecent: number
    stuck: number
    pausedProviders: string[]
  }
}

export async function GET(req: Request) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const failedSince = new Date(Date.now() - RECENT_FAILURE_MS)

    const [stageGroups, inFlightGroups, failedRecent, stuck, settings] = await Promise.all([
      // Sandbox dikecualikan di sini dengan alasan yang sama seperti di antrean chat: di
      // seberangnya bukan pelanggan, jadi ia bukan bagian dari funnel penjualan siapa pun.
      prisma.conversation.groupBy({
        by: ['pipelineStage'],
        where: { isTest: false },
        _count: { _all: true },
      }),
      prisma.outboundJob.groupBy({
        by: ['status'],
        where: { status: { in: [...IN_FLIGHT_STATUSES] } },
        _count: { _all: true },
      }),
      prisma.outboundJob.count({ where: { status: 'FAILED', updatedAt: { gte: failedSince } } }),
      // Definisi "macet" diambil dari src/lib/outbound/stuck.ts, bukan ditulis ulang di sini —
      // halaman Outbound Queue dan worker recovery memakai klausa yang sama persis.
      prisma.outboundJob.count({ where: stuckOutboundJobWhere() }),
      prisma.settings.findUnique({ where: { id: 1 }, select: { pausedProviders: true } }),
    ])

    const countByStage = new Map(stageGroups.map((g) => [g.pipelineStage, g._count._all]))

    // Urutan funnel milik PIPELINE_STAGES, bukan milik urutan baris yang dikembalikan Postgres.
    // Tahap yang tidak dikenal (data lama, ejaan lain) tetap ditampilkan di belakang apa adanya
    // — menjatuhkannya diam-diam membuat jumlah funnel tidak sama dengan jumlah percakapan.
    const funnel: DashboardOperations['funnel'] = PIPELINE_STAGES.map((s) => ({
      stage: s.value,
      label: s.label,
      count: countByStage.get(s.value) ?? 0,
    }))
    for (const g of stageGroups) {
      if (!funnel.some((f) => f.stage === g.pipelineStage)) {
        funnel.push({ stage: g.pipelineStage, label: g.pipelineStage, count: g._count._all })
      }
    }

    const inFlight: Record<string, number> = {}
    for (const status of IN_FLIGHT_STATUSES) inFlight[status] = 0
    for (const g of inFlightGroups) inFlight[g.status] = g._count._all

    const body: DashboardOperations = {
      funnel,
      conversationTotal: funnel.reduce((sum, f) => sum + f.count, 0),
      outbound: {
        inFlight,
        inFlightTotal: Object.values(inFlight).reduce((a, b) => a + b, 0),
        failedRecent,
        stuck,
        pausedProviders: settings?.pausedProviders ?? [],
      },
    }

    return NextResponse.json(body)
  } catch {
    return NextResponse.json({ error: 'Gagal membaca keadaan operasional' }, { status: 500 })
  }
}

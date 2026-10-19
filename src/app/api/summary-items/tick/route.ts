import { NextResponse } from 'next/server'
import { hasValidCronSecret } from '@/lib/outbound/cron-auth'
import { createLiveReplyItems, reconcileSummaryItems } from '@/lib/summary-items/sync'

/**
 * POST /api/summary-items/tick — antrean live Summary Harian, dipanggil crontab VPS tiap 5 menit
 * (`scripts/wa-inbox-summary-tick.sh`) dengan header `x-cron-secret`.
 *
 * Urutan: `reconcileSummaryItems` dulu (tutup yang sudah dibalas, pengingat jatuh tempo kembali
 * OPEN, FOLLOW_UP/PROMISE jadi REPLY), lalu `createLiveReplyItems` (pesan pelanggan yang belum
 * dibalas ≥ 1 jam masuk antrean tanpa menunggu 00:00). Murni DB -- tidak pernah memanggil LLM.
 *
 * Endpoint tersendiri, bukan `/api/outbound-jobs/process`: endpoint itu juga menjalankan retry
 * ladder outbound, dan menjadwalkannya adalah keputusan owner yang belum diambil.
 *
 * Hanya scheduler: tidak ada tombol yang memanggilnya (membuka /summary sudah me-reconcile).
 * Secret dicek ulang di sini, bukan hanya di middleware -- alasan yang sama dengan
 * POST /api/outbound-jobs/process.
 */
export async function POST(req: Request) {
  if (!hasValidCronSecret(req)) {
    return NextResponse.json({ error: 'Hanya scheduler yang bisa menjalankan tick antrean' }, { status: 401 })
  }
  try {
    const now = new Date()
    const reconciled = await reconcileSummaryItems(now)
    const live = await createLiveReplyItems(now)
    return NextResponse.json({ reconciled, live })
  } catch (error) {
    console.error('POST /api/summary-items/tick gagal', error instanceof Error ? error.message : 'unknown')
    return NextResponse.json({ error: 'Gagal menjalankan tick antrean' }, { status: 500 })
  }
}

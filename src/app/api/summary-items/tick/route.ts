import { NextResponse } from 'next/server'
import { hasValidCronSecret } from '@/lib/outbound/cron-auth'
import { pruneBotAuditLogs } from '@/lib/bot-control/audit'
import { advancePipelineStagesFromBooking, refreshStaleBookingData } from '@/lib/booking/client'
import { createLiveReplyItems, reconcileSummaryItems } from '@/lib/summary-items/sync'
import { releaseStaleExecuting } from '@/lib/booking-actions/execute'
import { createDataRequestDrafts } from '@/lib/booking-actions/data-requests'

/**
 * POST /api/summary-items/tick — antrean live Summary Harian, dipanggil crontab VPS tiap 5 menit
 * (`scripts/wa-inbox-summary-tick.sh`) dengan header `x-cron-secret`.
 *
 * Urutan:
 * 1. Kebersihan yang dulu HANYA menumpang `/api/outbound-jobs/process` (endpoint tanpa cron di
 *    produksi, jadi tidak pernah jalan): `pruneBotAuditLogs`, `advancePipelineStagesFromBooking`,
 *    `refreshStaleBookingData` -- urutan dan alasan sama dengan di sana, dan tetap dipanggil di
 *    sana juga supaya cron di masa depan pun bekerja (ketiganya idempoten). Tahap pipeline naik
 *    SEBELUM reconcile, supaya FOLLOW_UP tertutup STAGE_ADVANCED di tick yang sama.
 * 1b. `releaseStaleExecuting` (booking-actions/execute.ts): klaim "Setujui" yang macet > 2 menit.
 * 2. `reconcileSummaryItems` (tutup yang sudah dibalas, pengingat jatuh tempo kembali OPEN,
 *    FOLLOW_UP/PROMISE jadi REPLY).
 * 2b. `createDataRequestDrafts` (Task 12): draf H-7 harian permintaan data ke tamu (08:00-19:59 WIB saja),
 *    dikirim otomatis bila `dataRequestApproval = ALWAYS`. Galatnya hanya di-log; tidak menahan sisa tick.
 * 3. `createLiveReplyItems` (pesan pelanggan yang belum dibalas ≥ 1 jam masuk antrean tanpa
 *    menunggu 00:00).
 * Tidak pernah memanggil LLM. `refreshStaleBookingData` memanggil API booking (maks. 25
 * percakapan per tick, diacak dari 100 yang paling basi, berurutan, timeout 10 s per panggilan,
 * berhenti sesudah 60 s).
 *
 * Endpoint tersendiri, bukan `/api/outbound-jobs/process`: endpoint itu juga menjalankan retry
 * ladder outbound (`processDueOutboundJobs`), dan menjadwalkannya adalah keputusan owner yang
 * belum diambil. Jangan panggil apa pun dari retry ladder di sini.
 *
 * Hanya scheduler: tidak ada tombol yang memanggilnya (membuka /summary sudah me-reconcile).
 * Secret dicek ulang di sini, bukan hanya di middleware -- alasan yang sama dengan
 * POST /api/outbound-jobs/process.
 */
/**
 * Single-flight per proses: tick yang masih berjalan (API booking lambat) tidak boleh ditumpuk
 * tick berikutnya -- dua `createLiveReplyItems` bersamaan berebut membuat baris yang sama (P2002)
 * dan menggandakan panggilan API booking. Server ini satu proses Node (pm2), jadi variabel modul
 * cukup; skrip cron juga memakai `flock -n` sebagai lapis kedua.
 */
let running = false

export async function POST(req: Request) {
  if (!hasValidCronSecret(req)) {
    return NextResponse.json({ error: 'Hanya scheduler yang bisa menjalankan tick antrean' }, { status: 401 })
  }
  if (running) return NextResponse.json({ busy: true })
  running = true
  try {
    return await tick()
  } finally {
    running = false
  }
}

async function tick(): Promise<NextResponse> {
  // Housekeeping first and unguarded-by-the-tally: `pruneBotAuditLogs` never throws, and the
  // `.catch` is the belt to that braces — a future edit that makes it throw must still not be
  // able to take the queue down with it.
  await pruneBotAuditLogs().catch((error: unknown) => {
    console.error('POST /api/summary-items/tick: pruning audit log gagal', error)
  })

  // Menumpang tick yang sama, dan dengan alasan yang sama seperti pruning: ia butuh dijalankan
  // berkala, tapi tidak sepadan dengan cron entry sendiri (berarti secret kedua, path middleware
  // kedua, dan satu hal lagi yang bisa lupa dikonfigurasi).
  //
  // Kenapa berkala: tahap `selesai` datang dari tanggal trip yang lewat, bukan dari ada yang
  // mengetik. Tanpa penyapu ini tahap hanya naik saat percakapan dibuka atau bot membalas, dan
  // percakapan yang tripnya sudah selesai justru percakapan yang tidak ada lagi yang membukanya.
  await advancePipelineStagesFromBooking().catch((error: unknown) => {
    console.error('POST /api/summary-items/tick: menaikkan tahap pipeline gagal', error)
  })

  // Menyusul yang di atas, dan menutup lubang yang tidak bisa ditutup olehnya: fungsi itu hanya
  // menilai ulang percakapan yang SUDAH punya bookingData. Yang datanya belum pernah diambil
  // sama sekali tetap berlencana "Baru" selamanya sampai ada yang membukanya -- 269 dari 340
  // percakapan ada di keadaan itu saat ditemukan. Dibatasi 25 per tick karena tiap percakapan
  // berarti satu panggilan HTTP ke API booking.
  await refreshStaleBookingData().catch((error: unknown) => {
    console.error('POST /api/summary-items/tick: menyegarkan data booking gagal', error)
  })

  // Klaim "Setujui" booking yang macet (proses mati di tengah tulis, > 2 menit) -- satu kueri untuk
  // semua percakapan. Sesudah penyegaran booking: yang tulisannya ternyata masuk ditutup
  // MATCHED_IN_BACKOFFICE, sisanya kembali OPEN. Tanpa ini kartu baru muncul lagi saat panel dibuka.
  await releaseStaleExecuting().catch((error: unknown) => {
    console.error('POST /api/summary-items/tick: melepas klaim eksekusi booking gagal', error instanceof Error ? error.message : 'unknown')
  })

  try {
    const now = new Date()
    const reconciled = await reconcileSummaryItems(now)
    // Tidak boleh menggagalkan antrean: draf data tamu hanya tambahan. Log tanpa teks pelanggan.
    await createDataRequestDrafts(now).catch((error: unknown) => {
      console.error('POST /api/summary-items/tick: draf permintaan data gagal', error instanceof Error ? error.name : 'unknown')
    })
    const live = await createLiveReplyItems(now)
    return NextResponse.json({ reconciled, live })
  } catch (error) {
    console.error('POST /api/summary-items/tick gagal', error instanceof Error ? error.message : 'unknown')
    return NextResponse.json({ error: 'Gagal menjalankan tick antrean' }, { status: 500 })
  }
}

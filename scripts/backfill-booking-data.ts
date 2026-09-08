/**
 * Backfill satu kali: ambil data booking untuk SETIAP percakapan yang belum pernah dicek
 * atau cache-nya basi, lalu naikkan tahap pipeline-nya.
 *
 * Dipakai sekali setelah menemukan 269 dari 340 percakapan tidak punya data booking sama
 * sekali -- semuanya berlencana "Baru" terlepas dari apakah pelanggannya benar-benar punya
 * booking. Ke depan `refreshStaleBookingData()` di cron antrean outbound menjaganya tetap
 * terisi, tapi ia sengaja dibatasi 25 per tick, jadi tumpukan awal ini dikejar sekali di sini.
 *
 * Berurutan, bukan paralel: mengalirkan ratusan permintaan serentak ke API booking pihak
 * ketiga adalah cara membuatnya membatasi kita.
 *
 * Aman diulang. Berhenti sendiri saat tidak ada lagi yang perlu dicek.
 */
import { config } from 'dotenv'

config()

type Db = typeof import('@/lib/db')['prisma']
let prisma: Db

async function main() {
  prisma = (await import('@/lib/db')).prisma
  const { refreshStaleBookingData } = await import('@/lib/booking/client')

  const BATCH = 25
  let total = 0
  let putaran = 0

  for (;;) {
    const { diperiksa } = await refreshStaleBookingData(BATCH)
    total += diperiksa
    putaran += 1
    console.log(`putaran ${putaran}: ${diperiksa} diperiksa (total ${total})`)
    if (diperiksa < BATCH) break
    if (putaran > 40) {
      console.log('Berhenti di 40 putaran sebagai pengaman. Jalankan lagi untuk melanjutkan.')
      break
    }
  }

  const [sesudah] = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT
       COUNT(*)::int                                            AS total,
       COUNT(*) FILTER (WHERE "bookingCheckedAt" IS NULL)::int   AS belum_pernah_dicek,
       COUNT(*) FILTER (WHERE "bookingData" IS NOT NULL)::int    AS punya_booking
     FROM "Conversation" WHERE NOT "isTest"`,
  )
  console.log('\n--- Sesudah backfill ---')
  console.log(JSON.stringify(sesudah, null, 2))

  const sebaran = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT "pipelineStage", COUNT(*)::int AS jumlah FROM "Conversation"
      WHERE NOT "isTest" GROUP BY "pipelineStage" ORDER BY 2 DESC`,
  )
  console.log('\n--- Sebaran tahap pipeline ---')
  console.log(JSON.stringify(sebaran, null, 2))
}

main()
  .catch((e) => {
    console.error('FATAL:', e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
  .finally(() => prisma?.$disconnect())

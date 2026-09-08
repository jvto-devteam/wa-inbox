/**
 * Diagnosa READ-ONLY: berapa percakapan yang datanya belum pernah diambil sama sekali,
 * yang cache-nya sudah basi, dan yang tahapnya tertinggal. Tidak mengubah apa pun.
 */
import { config } from 'dotenv'

config()

type Db = typeof import('@/lib/db')['prisma']
let prisma: Db

async function main() {
  prisma = (await import('@/lib/db')).prisma

  const [ringkas] = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT
       COUNT(*)::int                                                        AS total,
       COUNT(*) FILTER (WHERE "bookingCheckedAt" IS NULL)::int              AS belum_pernah_dicek,
       COUNT(*) FILTER (WHERE "bookingData" IS NOT NULL)::int               AS punya_booking,
       COUNT(*) FILTER (WHERE "bookingCheckedAt" IS NOT NULL
                          AND "bookingCheckedAt" < now() - interval '24 hours')::int AS cache_basi,
       COUNT(*) FILTER (WHERE "isTest")::int                                AS sandbox
     FROM "Conversation"`,
  )
  console.log('--- Cakupan data booking ---')
  console.log(JSON.stringify(ringkas, null, 2))

  const contoh = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT ct."name", c."pipelineStage", c."orderChannel", c."bookingCheckedAt"
       FROM "Conversation" c JOIN "Contact" ct ON ct."id" = c."contactId"
      WHERE c."bookingCheckedAt" IS NULL AND NOT c."isTest"
      ORDER BY c."lastMessageAt" DESC NULLS LAST LIMIT 10`,
  )
  console.log('\n--- 10 terbaru yang BELUM PERNAH dicek (ini yang tampil "Baru" keliru) ---')
  console.log(JSON.stringify(contoh, null, 2))
}

main()
  .catch((e) => {
    console.error('FATAL:', e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
  .finally(() => prisma?.$disconnect())

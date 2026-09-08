/**
 * Diagnosa READ-ONLY: percakapan yang punya bookingData tapi tahap pipeline-nya
 * belum ikut naik (atau orderChannel-nya kosong). Tidak mengubah apa pun.
 */
import { config } from 'dotenv'

config()

type Db = typeof import('@/lib/db')['prisma']
let prisma: Db

async function main() {
  prisma = (await import('@/lib/db')).prisma

  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT c."id",
            ct."name",
            c."pipelineStage",
            c."orderChannel",
            (c."bookingData" IS NOT NULL)                       AS punya_booking,
            c."bookingData"->'financial'->>'balance'            AS balance,
            c."bookingData"->'date'->>'end_ymd'                 AS end_ymd,
            c."bookingData"->>'orderChannel'                    AS booking_order_channel,
            c."bookingCheckedAt"
       FROM "Conversation" c
       JOIN "Contact" ct ON ct."id" = c."contactId"
      WHERE c."bookingData" IS NOT NULL
      ORDER BY c."lastMessageAt" DESC NULLS LAST
      LIMIT 40`,
  )

  console.log(`Percakapan dengan bookingData: ${rows.length}\n`)
  const salah: Record<string, unknown>[] = []
  for (const r of rows) {
    const bal = r.balance == null ? null : Number(r.balance)
    const end = r.end_ymd as string | null
    const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD, sama seperti end_ymd
    const seharusnya =
      end && end < today ? 'selesai' : bal != null && bal <= 0 ? 'lunas' : 'booked'
    const rank: Record<string, number> = { new: 0, nego: 1, booked: 2, lunas: 3, selesai: 4 }
    const tertinggal = (rank[String(r.pipelineStage)] ?? -1) < (rank[seharusnya] ?? -1)
    const channelKosong = !r.orderChannel && r.booking_order_channel
    if (tertinggal || channelKosong) {
      salah.push({
        nama: r.name,
        tahap_sekarang: r.pipelineStage,
        tahap_seharusnya: seharusnya,
        orderChannel: r.orderChannel,
        orderChannel_di_booking: r.booking_order_channel,
        balance: r.balance,
        dicek_terakhir: r.bookingCheckedAt,
      })
    }
  }

  console.log(`Yang tidak sinkron: ${salah.length}`)
  console.log(JSON.stringify(salah, null, 2))
}

main()
  .catch((e) => {
    console.error('FATAL:', e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
  .finally(() => prisma?.$disconnect())

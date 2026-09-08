/**
 * Membersihkan sisa mirror katalog di `KnowledgeSource` (langkah data item b7).
 *
 * Setelah `KnowledgeChunk` di-DROP dan Knowledge Explorer membaca `catalog/*.json`
 * langsung dari disk, baris `type='CATALOG_JSON'` tidak punya pembaca lagi — tapi
 * `GET /api/bot-control/knowledge/sources` TIDAK menyaring `type`, sehingga baris itu
 * tampil di UI seolah sumber managed.
 *
 * PENGAMAN (sesuai b7-data-migration-notes.sql):
 *  - predikat POSITIF (`type = 'CATALOG_JSON'`), tidak pernah negatif (`<> 'MANUAL'`) —
 *    predikat negatif akan menyapu tipe tak dikenal dan NULL;
 *  - jumlah baris MANUAL dihitung sebelum dan sesudah, di dalam transaksi yang sama;
 *    kalau berubah satu pun, transaksi dibatalkan;
 *  - `KnowledgeRevision` cascade saat sumbernya dihapus, jadi revisi yang menggantung
 *    di baris katalog dihitung lebih dulu dan penghapusan dibatalkan kalau ada.
 */
import { config } from 'dotenv'

config()

type Db = typeof import('@/lib/db')['prisma']
let prisma: Db

async function main() {
  prisma = (await import('@/lib/db')).prisma
  const terapkan = process.argv.includes('--terapkan')

  const sebelum = await prisma.$queryRawUnsafe<{ type: string; baris: number }[]>(
    `SELECT "type", COUNT(*)::int AS baris FROM "KnowledgeSource" GROUP BY "type" ORDER BY 1`,
  )
  console.log('--- KnowledgeSource per tipe, sebelum ---')
  console.log(JSON.stringify(sebelum, null, 2))

  const revisiMenggantung = await prisma.$queryRawUnsafe<{ baris: number }[]>(
    `SELECT COUNT(*)::int AS baris FROM "KnowledgeRevision" r
       JOIN "KnowledgeSource" s ON s."id" = r."knowledgeSourceId"
      WHERE s."type" = 'CATALOG_JSON'`,
  )
  const jumlahRevisi = revisiMenggantung[0]?.baris ?? 0
  console.log(`\nRevisi yang menggantung di baris katalog: ${jumlahRevisi}`)
  if (jumlahRevisi > 0) {
    console.log('BERHENTI: ada revisi yang akan ikut terhapus lewat cascade. Perlu keputusan manusia.')
    return
  }

  if (!terapkan) {
    console.log('\n(mode pratinjau — jalankan ulang dengan --terapkan untuk benar-benar menghapus)')
    return
  }

  await prisma.$transaction(async (tx) => {
    const [{ baris: manualSebelum }] = await tx.$queryRawUnsafe<{ baris: number }[]>(
      `SELECT COUNT(*)::int AS baris FROM "KnowledgeSource" WHERE "type" = 'MANUAL'`,
    )
    const terhapus = await tx.$executeRawUnsafe(
      `DELETE FROM "KnowledgeSource" WHERE "type" = 'CATALOG_JSON'`,
    )
    const [{ baris: manualSesudah }] = await tx.$queryRawUnsafe<{ baris: number }[]>(
      `SELECT COUNT(*)::int AS baris FROM "KnowledgeSource" WHERE "type" = 'MANUAL'`,
    )
    if (manualSebelum !== manualSesudah) {
      throw new Error(
        `DIBATALKAN: baris MANUAL berubah ${manualSebelum} -> ${manualSesudah}. Tidak ada yang dihapus.`,
      )
    }
    console.log(`\nTerhapus: ${terhapus} baris CATALOG_JSON. MANUAL tetap ${manualSesudah}.`)
  })

  const sesudah = await prisma.$queryRawUnsafe<{ type: string; baris: number }[]>(
    `SELECT "type", COUNT(*)::int AS baris FROM "KnowledgeSource" GROUP BY "type" ORDER BY 1`,
  )
  console.log('\n--- KnowledgeSource per tipe, sesudah ---')
  console.log(sesudah.length ? JSON.stringify(sesudah, null, 2) : '(kosong)')
}

main()
  .catch((error) => {
    console.error('FATAL:', error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => prisma?.$disconnect())

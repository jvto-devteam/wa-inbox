/**
 * Ubah jawaban buruk yang ditandai agen jadi kandidat golden case.
 *
 * READ-ONLY. Keluarannya potongan TypeScript ke stdout -- sengaja TIDAK menulis ke
 * fixtures.ts sendiri: ekspektasi sebuah kasus uji adalah penilaian manusia tentang
 * jawaban yang BENAR, dan skrip tidak tahu itu. Yang diotomatiskan hanya bagian
 * mekanisnya -- mengambil pesan aslinya tanpa salah ketik.
 */
import { config } from 'dotenv'

config()

async function main() {
  const { prisma } = await import('@/lib/db')

  const flagged = await prisma.botDecisionRun.findMany({
    where: { flaggedAt: { not: null } },
    select: { id: true, inboundText: true, replyText: true, flagNote: true },
    orderBy: { flaggedAt: 'desc' },
    take: 20,
  })

  if (flagged.length === 0) {
    console.error('Tidak ada keputusan yang ditandai. Tandai jawaban buruk dari inbox dulu.')
    await prisma.$disconnect()
    return
  }

  for (const run of flagged) {
    console.log(`  // Ditandai agen. Alasan: ${run.flagNote ?? '(tanpa alasan)'}`)
    console.log(`  // Balasan yang salah: ${(run.replyText ?? '').replace(/\s+/g, ' ').slice(0, 120)}`)
    console.log(`  {`)
    console.log(`    id: 'flagged-${run.id.slice(0, 8)}',`)
    console.log(`    turns: [${JSON.stringify(run.inboundText)}],`)
    console.log(`    // ISI SENDIRI: frasa huruf kecil yang WAJIB ada di balasan yang benar`)
    console.log(`    mustContain: [],`)
    console.log(`    // ISI SENDIRI: frasa huruf kecil yang TIDAK BOLEH ada`)
    console.log(`    mustNotContain: [],`)
    console.log(`    source: ${JSON.stringify(`BotDecisionRun ${run.id}, ditandai agen: ${run.flagNote ?? '(tanpa alasan)'}`)},`)
    console.log(`  },`)
  }

  console.error(`\n${flagged.length} kandidat. Isi mustContain/mustNotContain, tempel ke EVAL_CASES di fixtures.ts; jalankan npm run eval begitu eval diaktifkan (Ruling R52).`)
  await prisma.$disconnect()
}

main().catch((error) => {
  console.error('Gagal:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})

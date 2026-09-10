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

/** Shape of the fields selected from `BotDecisionRun` below -- kept local so the printing
 * logic can be extracted (and type-checked) without a DB round-trip. */
type FlaggedRun = {
  id: string
  inboundText: string
  replyText: string | null
  flagNote: string | null
}

/**
 * Renders one flagged run as a pasteable `EvalCase` snippet (plus two lead-in comment lines).
 *
 * `flagNote` and `replyText` only ever reach the API's `.trim()` (see
 * `src/app/api/bot-control/decisions/[id]/flag/route.ts`), so either can carry an embedded
 * newline. Printed as a bare `//` comment, a newline would end the comment mid-sentence and
 * leave its second line as invalid bare TypeScript -- so both are whitespace-collapsed and
 * length-capped here, the same treatment, before they land outside a string literal. Every
 * other value that reaches the snippet outside `JSON.stringify` (`run.id.slice(0, 8)`) is a
 * UUID with no whitespace to collapse. Inside `JSON.stringify` (`turns`, `source`) a newline,
 * backtick, or a comment-close sequence is escaped into a valid string literal regardless, so
 * those are left as-is.
 */
function formatFixtureSnippet(run: FlaggedRun): string {
  const shortReason = (run.flagNote ?? '(tanpa alasan)').replace(/\s+/g, ' ').slice(0, 120)
  const shortReply = (run.replyText ?? '').replace(/\s+/g, ' ').slice(0, 120)
  return [
    `  // Ditandai agen. Alasan: ${shortReason}`,
    `  // Balasan yang salah: ${shortReply}`,
    `  {`,
    `    id: 'flagged-${run.id.slice(0, 8)}',`,
    `    turns: [${JSON.stringify(run.inboundText)}],`,
    `    // ISI SENDIRI: frasa huruf kecil yang WAJIB ada di balasan yang benar`,
    `    mustContain: [],`,
    `    // ISI SENDIRI: frasa huruf kecil yang TIDAK BOLEH ada`,
    `    mustNotContain: [],`,
    `    source: ${JSON.stringify(`BotDecisionRun ${run.id}, ditandai agen: ${run.flagNote ?? '(tanpa alasan)'}`)},`,
    `  },`,
  ].join('\n')
}

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
    console.log(formatFixtureSnippet(run))
  }

  console.error(`\n${flagged.length} kandidat. Isi mustContain/mustNotContain, tempel ke EVAL_CASES di fixtures.ts; jalankan npm run eval begitu eval diaktifkan (Ruling R52).`)
  await prisma.$disconnect()
}

main().catch((error) => {
  console.error('Gagal:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})

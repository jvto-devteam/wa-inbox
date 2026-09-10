/**
 * Setiap revisi PUBLISHED yang sudah ada HARUS tetap lolos skema body yang baru.
 *
 * Kalau gagal, `readKnowledgeBody` mengembalikan null dan revisi itu dilewati DIAM-DIAM:
 * bot kehilangan knowledge tanpa satu pun error. Ini edge case E1 di PRD.
 *
 * READ-ONLY. Keluar dengan kode 1 kalau ada yang gagal.
 */
import { config } from 'dotenv'

config()

async function main() {
  const { prisma } = await import('@/lib/db')
  const { validateKnowledgeBody } = await import('@/lib/bot-control/knowledge-body')

  const revisions = await prisma.knowledgeRevision.findMany({
    where: { status: 'PUBLISHED' },
    select: { id: true, version: true, body: true, knowledgeSource: { select: { key: true } } },
  })

  let bad = 0
  for (const revision of revisions) {
    const result = validateKnowledgeBody(revision.body)
    if (!result.ok) {
      bad++
      console.error(`GAGAL  ${revision.knowledgeSource.key} v${revision.version}: ${result.error}`)
    }
  }

  console.log(`${revisions.length - bad}/${revisions.length} revisi PUBLISHED lolos skema.`)
  await prisma.$disconnect()
  if (bad) process.exit(1)
}

main().catch((error) => {
  console.error('Gagal:', error instanceof Error ? error.message : error)
  process.exit(1)
})

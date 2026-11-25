/**
 * Audit standar Antrean (docs/aturan-antrean.md, bagian "Audit"). Hanya membaca.
 *
 *   npm run audit:antrean
 *
 * Untuk setiap item Balas/Follow Up/Janji Admin yang terbuka: apakah ada aturan AQ yang seharusnya mengeluarkannya
 * (`exclusionFor` -- harus nol, karena tick 5 menit menutupnya), dan tanda yang perlu dilihat manusia karena data AI-nya
 * belum cukup untuk memutuskan. Keluar dengan kode 1 bila ada item yang melanggar aturan (bisa dipakai di cron/CI).
 */
import { prisma } from '@/lib/db'
import { EXCLUSION_NOTE, exclusionFor, teamOwed, tripEndDay, tripStartDay } from '@/lib/summary-items/exclusion'

const KIND_LABEL: Record<string, string> = { REPLY: 'Balas', FOLLOW_UP: 'Follow Up', PROMISE: 'Janji Admin' }

async function main() {
  const items = await prisma.summaryItem.findMany({
    where: { state: 'OPEN' },
    orderBy: [{ kind: 'asc' }, { anchorAt: 'asc' }],
    select: {
      id: true, kind: true, review: true, conversationId: true,
      conversation: { select: { createdAt: true, bookingData: true, chatReview: true, contact: { select: { name: true } } } },
    },
  })
  let violations = 0
  for (const it of items) {
    const c = it.conversation
    const reason = await exclusionFor(it.conversationId, it.kind, it.review)
    const flags: string[] = []
    if (!c.chatReview) flags.push('TANPA_RINGKASAN')
    if (it.kind !== 'REPLY' && !c.bookingData && !tripStartDay(c.chatReview, c.createdAt) && !tripEndDay(c.chatReview, c.createdAt)) flags.push('TANGGAL_TRIP_BELUM_DIKETAHUI')
    const agentReplies = await prisma.message.count({ where: { conversationId: it.conversationId, direction: 'OUTBOUND', sentBy: 'AGENT' } })
    if (agentReplies === 0) flags.push('HANYA_DIBALAS_BOT')
    if (it.kind === 'PROMISE' && !teamOwed(c.chatReview)) flags.push('JANJI_TIDAK_TERCATAT_DI_RINGKASAN')
    if (reason) violations++
    const verdict = reason ? `TIDAK LAYAK (${reason}: ${EXCLUSION_NOTE[reason]})` : flags.length ? 'PERLU DICEK' : 'LAYAK'
    console.log([KIND_LABEL[it.kind] ?? it.kind, (c.contact?.name ?? '?').slice(0, 24), verdict, flags.join(',')].join(' | '))
  }
  console.log(`\n${items.length} item; ${violations} melanggar aturan.`)
  if (violations > 0) process.exitCode = 1
}

main().finally(() => prisma.$disconnect())

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/require-admin'

// Same "emergency-scale lever" reasoning as /api/bot/mode -- this reaches every Indonesian
// conversation company-wide, so only an admin may flip it.
export async function POST(req: Request) {
  const admin = await requireAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Hanya admin yang bisa mengubah filter ini' }, { status: 403 })

  const current = await prisma.settings.findUniqueOrThrow({ where: { id: 1 } })
  const next = !current.skipBotForIndonesianNumbers
  const updated = await prisma.settings.update({ where: { id: 1 }, data: { skipBotForIndonesianNumbers: next } })

  // On: bulk-deactivate the bot for every Indonesian-number conversation, regardless of
  // whatever botEnabled they already had (an agent's earlier per-chat override included --
  // same "bulk write always wins" precedent /api/bot/mode already sets for botAutoReplyAll).
  // Off: those conversations fall back to whatever the overall bot mode currently is, exactly
  // as if the filter had never singled them out.
  await prisma.conversation.updateMany({
    where: { contact: { phone: { startsWith: '62' } } },
    data: { botEnabled: next ? false : current.botAutoReplyAll },
  })

  return NextResponse.json({ skipBotForIndonesianNumbers: updated.skipBotForIndonesianNumbers })
}

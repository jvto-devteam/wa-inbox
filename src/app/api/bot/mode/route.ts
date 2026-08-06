import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/require-admin'

// Flipping the global bot mode reaches every conversation company-wide.
// That is an emergency-scale lever, not something any agent should be able to pull.
export async function POST(req: Request) {
  const admin = await requireAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Hanya admin yang bisa mengubah mode bot' }, { status: 403 })

  const current = await prisma.settings.findUniqueOrThrow({ where: { id: 1 } })
  const next = !current.botAutoReplyAll
  const updated = await prisma.settings.update({ where: { id: 1 }, data: { botAutoReplyAll: next } })

  // On ("aktif untuk semua chat") bulk-activates every conversation; Off ("aktifkan manual per
  // chat") bulk-deactivates every conversation, leaving per-chat re-activation to agents via
  // src/app/api/conversations/[id]/toggle-bot. Without this bulk write, the mode toggle would
  // only affect brand-new conversations (see src/lib/inbound.ts's defaultBotEnabled) and every
  // existing conversation would keep whatever botEnabled it already had -- not the "for all
  // chats" / "manual per chat" behavior the toggle promises.
  //
  // EXCEPT Indonesian-number conversations when skipBotForIndonesianNumbers is on (see
  // src/app/api/bot/indonesia-filter/route.ts) -- that filter must survive an unrelated
  // botAutoReplyAll flip, so turning the bot back On must not silently re-activate the numbers
  // the operator specifically asked to keep human-handled. Moot when turning Off (`next` is
  // false either way) or when the filter isn't active, so those cases keep the original single
  // unconditional bulk write.
  if (next && current.skipBotForIndonesianNumbers) {
    await prisma.conversation.updateMany({ where: { contact: { phone: { not: { startsWith: '62' } } } }, data: { botEnabled: true } })
    await prisma.conversation.updateMany({ where: { contact: { phone: { startsWith: '62' } } }, data: { botEnabled: false } })
  } else {
    await prisma.conversation.updateMany({ data: { botEnabled: next } })
  }

  return NextResponse.json({ botAutoReplyAll: updated.botAutoReplyAll })
}

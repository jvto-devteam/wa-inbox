import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { Platform } from '@prisma/client'
import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/require-admin'
import { writeBotAuditLog } from '@/lib/bot-control/audit'

/**
 * Sakelar autoreply bot per platform.
 *
 * Meniru /api/bot/mode: ia PENULIS MASSAL, bukan gerbang runtime kedua. Gerbang saat pesan
 * masuk tetap satu -- Conversation.botEnabled. Kalau sakelar ini dibuat sebagai gerbang
 * tambahan yang di-AND-kan, mematikan lalu menyalakan sebuah channel tidak akan benar-benar
 * menghidupkan chat-chatnya, dan "Ambil Alih dari Bot" per chat bisa tertimpa diam-diam.
 *
 * Konsekuensi yang diterima sadar: menyalakan ulang sebuah channel MENGHAPUS override
 * per-chat di channel itu -- preseden "bulk write always wins" yang sama dengan sakelar global.
 */
const TOGGLE_BY_PLATFORM = {
  WHATSAPP: 'botEnabledWhatsapp',
  INSTAGRAM: 'botEnabledInstagram',
  FACEBOOK: 'botEnabledFacebook',
  EMAIL: 'botEnabledEmail',
} as const

const bodySchema = z.object({
  platform: z.enum(['WHATSAPP', 'INSTAGRAM', 'FACEBOOK', 'EMAIL']),
})

export async function POST(req: Request) {
  const admin = await requireAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Hanya admin yang bisa mengubah sakelar channel' }, { status: 403 })

  try {
    const parsed = bodySchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json({ error: 'Platform tidak dikenal' }, { status: 400 })

    const platform: Platform = parsed.data.platform
    const column = TOGGLE_BY_PLATFORM[platform]

    const current = await prisma.settings.findUniqueOrThrow({ where: { id: 1 } })
    const next = !current[column]
    const updated = await prisma.settings.update({ where: { id: 1 }, data: { [column]: next } })

    await prisma.conversation.updateMany({
      where: { channelIdentity: { platform } },
      data: { botEnabled: next },
    })

    const actor = await prisma.account.findUnique({ where: { id: admin.accountId }, select: { name: true } })
    await writeBotAuditLog({
      action: next ? 'ENABLE' : 'DISABLE',
      entityType: 'BOT_SETTING',
      entityKey: column,
      actorId: admin.accountId,
      actorName: actor?.name ?? null,
    })

    return NextResponse.json({ platform, enabled: updated[column] })
  } catch {
    return NextResponse.json({ error: 'Gagal mengubah sakelar channel' }, { status: 500 })
  }
}

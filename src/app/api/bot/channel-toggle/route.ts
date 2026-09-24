import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { Platform } from '@prisma/client'
import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/require-admin'
import { writeBotAuditLog } from '@/lib/bot-control/audit'
import { hasPhoneNumber, BOT_TOGGLE_COLUMN_BY_PLATFORM } from '@/lib/channel/platform'

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
 *
 * SATU pengecualian atas "bulk write always wins", dan ia bukan override per-chat melainkan
 * sakelar operator lain: `Settings.skipBotForIndonesianNumbers`. Tanpa itu, operator yang
 * menyalakan filter nomor Indonesia (semua percakapan +62 -> botEnabled false) lalu mematikan
 * dan menyalakan lagi sakelar WhatsApp akan mengembalikan SELURUH percakapan +62 ke true,
 * sementara /chatbot masih menampilkan filternya menyala -- bot membalas otomatis pelanggan
 * Indonesia yang secara eksplisit diminta ditangani manusia. Dua tulisan terpisah, persis
 * seperti src/app/api/bot/mode/route.ts, dan hanya untuk platform yang identitasnya memang
 * nomor telepon (hasPhoneNumber) -- filter itu tidak punya arti di IG/FB/email, dan menerapkan
 * where `phone startsWith '62'` di sana hanya akan menghasilkan penyaringan yang tampak berlaku
 * padahal tidak pernah mengenai apa pun. `defaultBotEnabled` sudah menghormati filter ini untuk
 * percakapan +62 yang baru lahir; sakelar ini dulu membatalkannya untuk yang sudah ada, jadi
 * satu fitur yang sama bertentangan dengan dirinya sendiri.
 */
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
    const column = BOT_TOGGLE_COLUMN_BY_PLATFORM[platform]

    const current = await prisma.settings.findUniqueOrThrow({ where: { id: 1 } })
    const next = !current[column]
    const updated = await prisma.settings.update({ where: { id: 1 }, data: { [column]: next } })

    // Menyalakan channel berbasis nomor saat filter nomor Indonesia aktif: dipecah dua supaya
    // percakapan +62 tidak ikut dihidupkan (lihat kepala file). Mematikan channel (`next` false)
    // dan platform tanpa nomor tidak terpengaruh -- keduanya tetap satu tulisan tanpa syarat.
    if (next && hasPhoneNumber(platform) && current.skipBotForIndonesianNumbers) {
      await prisma.conversation.updateMany({
        where: { channelIdentity: { platform }, contact: { phone: { not: { startsWith: '62' } } } },
        data: { botEnabled: true },
      })
      await prisma.conversation.updateMany({
        where: { channelIdentity: { platform }, contact: { phone: { startsWith: '62' } } },
        data: { botEnabled: false },
      })
    } else {
      await prisma.conversation.updateMany({
        where: { channelIdentity: { platform } },
        data: { botEnabled: next },
      })
    }

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

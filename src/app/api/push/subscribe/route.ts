import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'
import { parseJsonBody } from '@/lib/parse-json'

/**
 * Langganan Web Push. Terbuka untuk semua akun yang login (bukan keputusan bot, tidak
 * ada audit). Kunci p256dh/auth rahasia: tidak pernah dikembalikan atau di-log.
 */
const subscribeSchema = z.object({
  endpoint: z.url().max(2048),
  keys: z.object({ p256dh: z.string().min(1).max(512), auth: z.string().min(1).max(512) }),
})
const unsubscribeSchema = z.object({ endpoint: z.url().max(2048) })

export async function POST(req: Request) {
  try {
    const session = await getSession(req)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const parsed = await parseJsonBody(req, subscribeSchema, 'Data langganan tidak valid')
    if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 })
    const { endpoint, keys } = parsed.data
    await prisma.pushSubscription.upsert({
      where: { endpoint },
      create: { accountId: session.accountId, endpoint, p256dh: keys.p256dh, auth: keys.auth },
      update: { accountId: session.accountId, p256dh: keys.p256dh, auth: keys.auth },
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('POST push/subscribe gagal', error instanceof Error ? error.name : 'error')
    return NextResponse.json({ error: 'Gagal menyimpan langganan' }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  try {
    const session = await getSession(req)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const parsed = await parseJsonBody(req, unsubscribeSchema, 'Data langganan tidak valid')
    if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 })
    await prisma.pushSubscription.deleteMany({ where: { endpoint: parsed.data.endpoint, accountId: session.accountId } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('DELETE push/subscribe gagal', error instanceof Error ? error.name : 'error')
    return NextResponse.json({ error: 'Gagal mematikan langganan' }, { status: 500 })
  }
}

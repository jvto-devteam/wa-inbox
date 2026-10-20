import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'
import { parseJsonBody } from '@/lib/parse-json'

/**
 * Langganan Web Push. Terbuka untuk semua akun yang login (bukan keputusan bot, tidak
 * ada audit). Kunci p256dh/auth rahasia: tidak pernah dikembalikan atau di-log.
 */
const httpsEndpoint = z.url({ protocol: /^https$/ }).max(2048)
// p256dh = titik P-256 tak terkompresi (65 byte -> 87 char base64url); auth = 16 byte -> 22 char.
const b64url = (min: number, max: number) => z.string().regex(/^[A-Za-z0-9_-]+$/).min(min).max(max)
const subscribeSchema = z.object({
  endpoint: httpsEndpoint,
  keys: z.object({ p256dh: b64url(80, 95), auth: b64url(20, 26) }),
})
const unsubscribeSchema = z.object({ endpoint: httpsEndpoint })

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

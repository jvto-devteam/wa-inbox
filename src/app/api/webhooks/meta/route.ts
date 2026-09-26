import { NextResponse } from 'next/server'
import { verifyMetaSignature } from '@/lib/meta/webhook-verify'
import { ingestMetaMessage } from '@/lib/inbound'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const mode = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge')

  if (mode === 'subscribe' && token === process.env.META_WEBHOOK_VERIFY_TOKEN && challenge) {
    return new NextResponse(challenge, { status: 200 })
  }
  return new NextResponse('Forbidden', { status: 403 })
}

export async function POST(req: Request) {
  const rawBody = await req.text()
  const signature = req.headers.get('x-hub-signature-256')
  // Tiga app Meta menembak endpoint yang SAMA, masing-masing menandatangani dengan rahasianya
  // sendiri: WhatsApp lewat `Wa Dashboard`, Facebook Messenger lewat `Wa Dashboard JVTO`, dan
  // Instagram lewat app Instagram terpisah (`Wa Dashboard JVTO-IG`, id 1092291570210042) yang
  // punya app secret sendiri -- terlihat sebagai "Instagram app secret" di halaman use case,
  // BUKAN app secret Facebook-nya. Satu rahasia yang hilang di sini tidak menghasilkan error
  // yang bisa dibaca: seluruh pesan dari app itu ditolak 401 dan hilang tanpa jejak di Inbox,
  // persis derau 401 yang pernah kita telusuri berhari-hari pada 2026-09-25.
  const appSecrets = [
    process.env.META_APP_SECRET,
    process.env.FB_APP_SECRET,
    process.env.IG_APP_SECRET,
  ].filter((secret): secret is string => Boolean(secret))
  if (!verifyMetaSignature(rawBody, signature, appSecrets)) {
    return new Response('Invalid signature', { status: 401 })
  }

  let payload: Parameters<typeof ingestMetaMessage>[0]
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  try {
    await ingestMetaMessage(payload)
  } catch {
    return NextResponse.json({ error: 'Failed to process webhook' }, { status: 500 })
  }
  return new Response('OK', { status: 200 })
}

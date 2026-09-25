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
  const appSecrets = [process.env.META_APP_SECRET, process.env.FB_APP_SECRET].filter(
    (secret): secret is string => Boolean(secret),
  )
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

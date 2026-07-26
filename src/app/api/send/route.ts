import { NextResponse } from 'next/server'
import { z } from 'zod'
import { sendMessage } from '@/lib/send'
import { verifySessionToken } from '@/lib/auth/session'

const bodySchema = z.object({
  conversationId: z.string(),
  text: z.string().min(1),
  channel: z.enum(['OFFICIAL', 'UNOFFICIAL']).optional(),
})

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'conversationId dan text wajib diisi' }, { status: 400 })

  const token = req.headers.get('cookie')?.match(/wa_inbox_session=([^;]+)/)?.[1]
  const session = token ? await verifySessionToken(decodeURIComponent(token)) : null

  const message = await sendMessage({
    conversationId: parsed.data.conversationId,
    text: parsed.data.text,
    channel: parsed.data.channel,
    sentBy: 'AGENT',
    agentId: session?.accountId,
  })
  return NextResponse.json(message)
}

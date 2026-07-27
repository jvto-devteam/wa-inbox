import { NextResponse } from 'next/server'
import { z } from 'zod'
import { sendMessage } from '@/lib/send'
import { getSession } from '@/lib/auth/get-session'
import { prisma } from '@/lib/db'

// Two accepted shapes:
// - { conversationId, text } — the native wa-inbox shape (Task 9).
// - { to, text } — a phone-number-based compatibility shape kept for a future,
//   separately-authorized cutover of chatbot-web's legacy sender (Task 46 Step 1).
//   `to` is resolved to its Conversation via the unique Contact.phone.
const bodySchema = z.union([
  z.object({
    conversationId: z.string(),
    text: z.string().min(1),
    channel: z.enum(['OFFICIAL', 'UNOFFICIAL']).optional(),
  }),
  z.object({
    to: z.string(),
    text: z.string().min(1),
    channel: z.enum(['OFFICIAL', 'UNOFFICIAL']).optional(),
  }),
])

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'conversationId dan text wajib diisi' }, { status: 400 })

  let conversationId: string
  if ('conversationId' in parsed.data) {
    conversationId = parsed.data.conversationId
  } else {
    const contact = await prisma.contact.findUnique({
      where: { phone: parsed.data.to },
      include: { conversation: true },
    })
    if (!contact) return NextResponse.json({ error: 'Kontak tidak ditemukan' }, { status: 404 })
    if (!contact.conversation) return NextResponse.json({ error: 'Percakapan tidak ditemukan' }, { status: 404 })
    conversationId = contact.conversation.id
  }

  const session = await getSession(req)

  const message = await sendMessage({
    conversationId,
    text: parsed.data.text,
    channel: parsed.data.channel,
    sentBy: 'AGENT',
    agentId: session?.accountId,
  })
  return NextResponse.json(message)
}

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { sendMessage } from '@/lib/send'
import { getSession } from '@/lib/auth/get-session'
import { prisma } from '@/lib/db'
import { parseJsonBody } from '@/lib/parse-json'

// `url` points at wherever POST /api/uploads just stored the file (see that route) --
// a plain https URL, not raw bytes, since both send paths need to fetch it themselves
// (Meta downloads-then-reuploads it, wa-coexist fetches it directly).
const mediaSchema = z.object({
  url: z.string(),
  type: z.enum(['image', 'video', 'audio', 'document']),
  mimeType: z.string(),
  fileName: z.string().optional(),
})

// Two accepted shapes:
// - { conversationId, text } — the native wa-inbox shape (Task 9).
// - { to, text } — a phone-number-based compatibility shape kept for a future,
//   separately-authorized cutover of chatbot-web's legacy sender (Task 46 Step 1).
//   `to` is resolved to its Conversation via the unique Contact.phone.
// `text` is optional in both, but not independently of `media`: a media-less send still
// needs real text, while an attachment can go out with no caption at all -- the .refine
// below is what actually enforces "at least one of the two", not the field types themselves.
const bodySchema = z.union([
  z
    .object({
      conversationId: z.string(),
      text: z.string().optional(),
      channel: z.enum(['OFFICIAL', 'UNOFFICIAL']).optional(),
      replyToId: z.string().optional(),
      media: mediaSchema.optional(),
    })
    .refine((d) => Boolean(d.text?.trim()) || Boolean(d.media), { message: 'Pesan atau lampiran wajib diisi' }),
  z
    .object({
      to: z.string(),
      text: z.string().optional(),
      channel: z.enum(['OFFICIAL', 'UNOFFICIAL']).optional(),
      replyToId: z.string().optional(),
      media: mediaSchema.optional(),
    })
    .refine((d) => Boolean(d.text?.trim()) || Boolean(d.media), { message: 'Pesan atau lampiran wajib diisi' }),
])

export async function POST(req: Request) {
  const parsed = await parseJsonBody(req, bodySchema, 'conversationId wajib diisi, dan pesan atau lampiran wajib diisi')
  if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 })

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
    text: parsed.data.text ?? '',
    channel: parsed.data.channel,
    sentBy: 'AGENT',
    agentId: session?.accountId,
    replyToId: parsed.data.replyToId,
    media: parsed.data.media,
  })
  return NextResponse.json(message)
}

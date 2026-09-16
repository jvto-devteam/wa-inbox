import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth/get-session'
import { parseJsonBody } from '@/lib/parse-json'
import { DraftError, reviseDraftWithPrompt } from '@/lib/inbox/message-draft'

const paramsSchema = z.object({ id: z.string().trim().min(1), messageId: z.string().trim().min(1) })
const reviseBodySchema = z.object({ prompt: z.string().trim().min(1).max(2000) }).strict()

/** Revisi draft memakai prompt agen, dengan konteks percakapan yang dibangun di service. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string; messageId: string }> }) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 })

  const parsedParams = paramsSchema.safeParse(await params)
  if (!parsedParams.success) return NextResponse.json({ error: 'Alamat pesan tidak valid' }, { status: 400 })

  const parsedBody = await parseJsonBody(req, reviseBodySchema, 'Prompt revisi tidak boleh kosong')
  if (!parsedBody.success) return NextResponse.json({ error: parsedBody.error }, { status: 400 })

  try {
    const draft = await reviseDraftWithPrompt({
      conversationId: parsedParams.data.id,
      messageId: parsedParams.data.messageId,
      accountId: session.accountId,
      prompt: parsedBody.data.prompt,
    })
    return NextResponse.json(draft)
  } catch (error) {
    if (error instanceof DraftError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('POST /api/conversations/[id]/messages/[messageId]/draft/revise gagal', error)
    return NextResponse.json({ error: 'Gagal merevisi draft' }, { status: 500 })
  }
}

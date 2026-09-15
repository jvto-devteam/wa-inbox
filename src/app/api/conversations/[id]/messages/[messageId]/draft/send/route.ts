import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth/get-session'
import { DraftError, sendDraft } from '@/lib/inbox/message-draft'

const paramsSchema = z.object({ id: z.string().trim().min(1), messageId: z.string().trim().min(1) })

/**
 * Kirim draft yang sudah disiapkan sebagai balasan yang mengutip pesan sumber. Terbuka untuk
 * semua yang login, sama seperti route draft lainnya -- lihat komentar di `../route.ts`.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string; messageId: string }> }) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 })

  const parsedParams = paramsSchema.safeParse(await params)
  if (!parsedParams.success) return NextResponse.json({ error: 'Alamat pesan tidak valid' }, { status: 400 })

  try {
    const result = await sendDraft({
      conversationId: parsedParams.data.id,
      messageId: parsedParams.data.messageId,
      accountId: session.accountId,
    })
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof DraftError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('POST /api/conversations/[id]/messages/[messageId]/draft/send gagal', error)
    return NextResponse.json({ error: 'Gagal mengirim draft' }, { status: 500 })
  }
}

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth/get-session'
import { parseJsonBody } from '@/lib/parse-json'
import { DraftError, generateDraft, editDraft } from '@/lib/inbox/message-draft'

const paramsSchema = z.object({ id: z.string().trim().min(1), messageId: z.string().trim().min(1) })
const editBodySchema = z.object({ text: z.string().max(4096) }).strict()

/**
 * Buat/buat-ulang draft jawaban untuk satu pesan masuk. Terbuka untuk semua yang login --
 * sama seperti `/api/inbox/retest`, ini pekerjaan harian agen (menyiapkan balasan, belum
 * mengirim apa pun), bukan tindakan yang mengubah apa yang bot lakukan, jadi tanpa audit log.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string; messageId: string }> }) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 })

  const parsedParams = paramsSchema.safeParse(await params)
  if (!parsedParams.success) return NextResponse.json({ error: 'Alamat pesan tidak valid' }, { status: 400 })

  try {
    const draft = await generateDraft({
      conversationId: parsedParams.data.id,
      messageId: parsedParams.data.messageId,
      accountId: session.accountId,
    })
    return NextResponse.json(draft)
  } catch (error) {
    if (error instanceof DraftError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('POST /api/conversations/[id]/messages/[messageId]/draft gagal', error)
    return NextResponse.json({ error: 'Gagal membuat draft' }, { status: 500 })
  }
}

/** Simpan revisi manual seorang agen atas draft yang sudah ada. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; messageId: string }> }) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 })

  const parsedParams = paramsSchema.safeParse(await params)
  if (!parsedParams.success) return NextResponse.json({ error: 'Alamat pesan tidak valid' }, { status: 400 })

  const parsedBody = await parseJsonBody(req, editBodySchema, 'Draft tidak boleh kosong')
  if (!parsedBody.success) return NextResponse.json({ error: parsedBody.error }, { status: 400 })
  if (!parsedBody.data.text.trim()) return NextResponse.json({ error: 'Draft tidak boleh kosong' }, { status: 400 })

  try {
    const draft = await editDraft({
      conversationId: parsedParams.data.id,
      messageId: parsedParams.data.messageId,
      accountId: session.accountId,
      text: parsedBody.data.text,
    })
    return NextResponse.json(draft)
  } catch (error) {
    if (error instanceof DraftError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('PATCH /api/conversations/[id]/messages/[messageId]/draft gagal', error)
    return NextResponse.json({ error: 'Gagal menyimpan draft' }, { status: 500 })
  }
}

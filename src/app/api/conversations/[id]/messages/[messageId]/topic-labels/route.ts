import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'
import { classifyAndStoreTopicLabels } from '@/lib/inbox/topic-labels'
import { readTopicLabels } from '@/lib/inbox/topic-labels-schema'

const paramsSchema = z.object({ id: z.string().trim().min(1), messageId: z.string().trim().min(1) })

/**
 * "Cek topik" untuk satu pesan masuk. Terbuka untuk semua yang login, seperti route flag: label
 * baca tidak mengubah apa yang bot lakukan. Label yang sudah ada dikembalikan tanpa memanggil model.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string; messageId: string }> }) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 })

  const parsed = paramsSchema.safeParse(await params)
  if (!parsed.success) return NextResponse.json({ error: 'Alamat pesan tidak valid' }, { status: 400 })
  const { id, messageId } = parsed.data

  try {
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      select: { conversationId: true, direction: true, content: true, topicLabels: true },
    })
    if (!message || message.conversationId !== id) {
      return NextResponse.json({ error: 'Pesan tidak ditemukan di percakapan ini' }, { status: 404 })
    }
    if (message.direction !== 'INBOUND' || !message.content?.trim()) {
      return NextResponse.json({ error: 'Hanya pesan masuk yang berteks yang bisa diperiksa topiknya' }, { status: 400 })
    }

    const existing = readTopicLabels(message.topicLabels)
    if (existing) return NextResponse.json({ topicLabels: existing })

    const labels = await classifyAndStoreTopicLabels(messageId, 'manual')
    if (!labels) {
      return NextResponse.json({ error: 'Topik gagal diperiksa. Coba lagi sebentar lagi.' }, { status: 500 })
    }
    return NextResponse.json({ topicLabels: labels })
  } catch (error) {
    console.error('POST /api/conversations/[id]/messages/[messageId]/topic-labels gagal', error)
    return NextResponse.json({ error: 'Gagal memeriksa topik' }, { status: 500 })
  }
}

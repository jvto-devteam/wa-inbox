import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(20).default(5),
  // Dipakai panel perbaikan untuk menemukan gap milik SATU jawaban, supaya ia bisa menandainya
  // selesai setelah operator menyatakan jawaban barunya sudah sesuai.
  messageId: z.string().trim().min(1).optional(),
})

/**
 * Gap knowledge yang belum ditangani, untuk lonceng di navigasi.
 *
 * `count` sengaja dihitung terpisah dari `items`: lencana menyebut SEMUA yang belum selesai,
 * sementara dropdown hanya memuat beberapa terbaru. Terbuka untuk semua yang login, sama
 * seperti route perbaikan yang dilayaninya (CLAUDE.md §6).
 */
export async function GET(req: Request) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 })

  const url = new URL(req.url)
  const parsed = querySchema.safeParse({
    limit: url.searchParams.get('limit') ?? undefined,
    messageId: url.searchParams.get('messageId') ?? undefined,
  })
  if (!parsed.success) return NextResponse.json({ error: 'Parameter limit tidak valid' }, { status: 400 })

  try {
    const where = { resolvedAt: null, ...(parsed.data.messageId ? { messageId: parsed.data.messageId } : {}) }
    const [count, rows] = await Promise.all([
      prisma.knowledgeGapLog.count({ where }),
      prisma.knowledgeGapLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: parsed.data.limit,
        include: { conversation: { include: { contact: true } } },
      }),
    ])

    return NextResponse.json({
      count,
      items: rows.map((gap) => ({
        id: gap.id,
        conversationId: gap.conversationId,
        // Kosong pada baris gap lama (ditulis orchestrator sebelum kolom ini ada) -- lonceng
        // menanganinya dengan hanya membuka percakapannya.
        messageId: gap.messageId,
        contactName: gap.conversation.contact.name,
        topic: gap.topic,
        reason: gap.reason,
        messageText: gap.messageText,
        createdAt: gap.createdAt.toISOString(),
      })),
    })
  } catch (error) {
    console.error('GET /api/inbox/gaps gagal', error)
    return NextResponse.json({ error: 'Gagal memuat gap knowledge' }, { status: 500 })
  }
}

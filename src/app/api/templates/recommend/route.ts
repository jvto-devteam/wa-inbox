import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'
import { parseJsonBody } from '@/lib/parse-json'
import { recommendTemplates } from '@/lib/bot/template-recommender'

const bodySchema = z.object({
  conversationId: z.string(),
  channel: z.enum(['OFFICIAL', 'UNOFFICIAL']),
})

// Agent-facing suggestion tool: analyzes the customer's latest inbound message and ranks
// existing templates (Cara Booking, Harga Paket, dst) as candidate replies, using the same
// local Ollama model the bot itself answers with (src/lib/bot/llm.ts). It only ever RANKS
// existing templates for a human to pick from in ComposeBox -- nothing here sends a message.
export async function POST(req: Request) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = await parseJsonBody(req, bodySchema, 'conversationId dan channel wajib diisi')
  if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const lastInbound = await prisma.message.findFirst({
    where: { conversationId: parsed.data.conversationId, direction: 'INBOUND', type: 'text' },
    orderBy: { createdAt: 'desc' },
  })
  if (!lastInbound?.content?.trim()) {
    return NextResponse.json({ error: 'Tidak ada pesan masuk untuk dianalisis' }, { status: 400 })
  }

  // Only templates actually sendable on the channel currently selected in ComposeBox -- an
  // OFFICIAL recommendation the Cloud API would reject (still PENDING/REJECTED) or a
  // QUICK_REPLY suggestion while the agent is on Official would both be dead ends to click.
  const templates = await prisma.template.findMany({
    where: parsed.data.channel === 'OFFICIAL' ? { type: 'OFFICIAL', metaStatus: 'APPROVED' } : { type: 'QUICK_REPLY' },
  })
  if (templates.length === 0) return NextResponse.json({ recommendations: [] })

  const settings = await prisma.settings.findUniqueOrThrow({ where: { id: 1 } })

  try {
    const recommendations = await recommendTemplates(lastInbound.content, templates, settings.ollamaModel)
    return NextResponse.json({ recommendations })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Gagal membuat rekomendasi template'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}

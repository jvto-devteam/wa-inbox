import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/require-admin'
import { suggestTemplates } from '@/lib/bot/template-suggester'

const SAMPLE_SIZE = 200

// Admin-only drafting aid for /templates: analyzes a sample of REAL customer inbound messages
// across the whole inbox (not one conversation) with the same local Ollama model the bot itself
// answers with (src/lib/bot/llm.ts), and proposes new QUICK_REPLY template drafts for recurring
// question patterns. It only ever RETURNS drafts for an admin to review/select/save -- see
// POST /api/templates for the actual creation, which this never calls itself.
export async function POST(req: Request) {
  const admin = await requireAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Hanya admin yang bisa membuat rekomendasi template' }, { status: 403 })

  const recentInbound = await prisma.message.findMany({
    where: { direction: 'INBOUND', type: 'text', content: { not: null } },
    orderBy: { createdAt: 'desc' },
    take: SAMPLE_SIZE,
    select: { content: true },
  })
  const messages = recentInbound.map((m) => m.content).filter((c): c is string => Boolean(c && c.trim()))
  if (messages.length === 0) return NextResponse.json({ suggestions: [] })

  const settings = await prisma.settings.findUniqueOrThrow({ where: { id: 1 } })

  try {
    const suggestions = await suggestTemplates(messages, settings.ollamaModel)
    return NextResponse.json({ suggestions })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Gagal membuat rekomendasi template'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}

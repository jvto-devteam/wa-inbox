import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const stage = url.searchParams.get('stage')
  const labelId = url.searchParams.get('labelId')

  const conversationFilter: Prisma.ConversationWhereInput = {}
  if (stage) conversationFilter.pipelineStage = stage
  if (labelId) conversationFilter.labels = { some: { labelId } }

  const where: Prisma.ContactWhereInput =
    stage || labelId ? { conversation: conversationFilter } : {}

  const contacts = await prisma.contact.findMany({
    where,
    include: { conversation: { include: { labels: { include: { label: true } } } } },
  })

  return NextResponse.json(
    contacts.map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      pipelineStage: c.conversation?.pipelineStage ?? 'new',
      lastContactAt: c.conversation?.lastMessageAt?.toISOString() ?? null,
      labels: c.conversation?.labels.map((l) => l.label.name) ?? [],
    })),
  )
}

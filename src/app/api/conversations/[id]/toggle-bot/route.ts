import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const current = await prisma.conversation.findUniqueOrThrow({ where: { id } })
  const updated = await prisma.conversation.update({ where: { id }, data: { botEnabled: !current.botEnabled } })
  return NextResponse.json({ botEnabled: updated.botEnabled })
}

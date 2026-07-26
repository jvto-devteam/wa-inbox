import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const conversation = await prisma.conversation.findUniqueOrThrow({ where: { id } })
  return NextResponse.json({ botEnabled: conversation.botEnabled })
}

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'

const bodySchema = z.object({ agentId: z.string().nullable() })

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'agentId wajib diisi (atau null)' }, { status: 400 })
  const conversation = await prisma.conversation.update({ where: { id }, data: { assignedAgentId: parsed.data.agentId } })
  return NextResponse.json(conversation)
}

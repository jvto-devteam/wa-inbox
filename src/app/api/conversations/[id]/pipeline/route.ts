import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'

const bodySchema = z.object({ stage: z.enum(['new', 'nego', 'booked', 'lunas']) })

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'Status pipeline tidak dikenali' }, { status: 400 })
  const conversation = await prisma.conversation.update({ where: { id }, data: { pipelineStage: parsed.data.stage } })
  return NextResponse.json(conversation)
}

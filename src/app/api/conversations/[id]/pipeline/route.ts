import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { parseJsonBody } from '@/lib/parse-json'

const bodySchema = z.object({ stage: z.enum(['new', 'nego', 'booked', 'lunas']) })

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const parsed = await parseJsonBody(req, bodySchema, 'Status pipeline tidak dikenali')
  if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const conversation = await prisma.conversation.update({ where: { id }, data: { pipelineStage: parsed.data.stage } })
  return NextResponse.json(conversation)
}

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { parseJsonBody } from '@/lib/parse-json'

const bodySchema = z.object({ agentId: z.string().nullable() })

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const parsed = await parseJsonBody(req, bodySchema, 'agentId wajib diisi (atau null)')
  if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 })

  // An agentId that doesn't reference a real Account trips the FK constraint
  // and surfaces as a raw Prisma P2003 500. Check up front so the caller gets
  // the same kind of legible 4xx the accounts DELETE route already returns.
  if (parsed.data.agentId !== null) {
    const agent = await prisma.account.findUnique({ where: { id: parsed.data.agentId }, select: { id: true } })
    if (!agent) return NextResponse.json({ error: 'Agen tidak ditemukan' }, { status: 404 })
  }

  const conversation = await prisma.conversation.update({ where: { id }, data: { assignedAgentId: parsed.data.agentId } })
  return NextResponse.json(conversation)
}

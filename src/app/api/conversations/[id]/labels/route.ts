import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'

const bodySchema = z.object({ labelId: z.string().min(1) })

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'labelId wajib diisi' }, { status: 400 })
  await prisma.labelOnConversation.create({ data: { conversationId: id, labelId: parsed.data.labelId } })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'labelId wajib diisi' }, { status: 400 })
  await prisma.labelOnConversation.delete({
    where: { labelId_conversationId: { conversationId: id, labelId: parsed.data.labelId } },
  })
  return NextResponse.json({ ok: true })
}

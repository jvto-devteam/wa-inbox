import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { verifySessionToken } from '@/lib/auth/session'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const notes = await prisma.note.findMany({
    where: { contactId: id },
    include: { author: true },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json(
    notes.map((n) => ({ id: n.id, body: n.body, authorName: n.author.name, createdAt: n.createdAt }))
  )
}

const bodySchema = z.object({ body: z.string().min(1) })

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'Isi catatan wajib diisi' }, { status: 400 })

  const token = req.headers.get('cookie')?.match(/wa_inbox_session=([^;]+)/)?.[1]
  const session = token ? await verifySessionToken(decodeURIComponent(token)) : null
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const note = await prisma.note.create({
    data: { contactId: id, authorId: session.accountId, body: parsed.data.body },
    include: { author: true },
  })
  return NextResponse.json({ id: note.id, body: note.body, authorName: note.author.name, createdAt: note.createdAt })
}

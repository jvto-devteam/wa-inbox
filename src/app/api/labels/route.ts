import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'

export async function GET() {
  return NextResponse.json(await prisma.label.findMany())
}

const createSchema = z.object({ name: z.string().min(1), color: z.string().min(1) })

export async function POST(req: Request) {
  const parsed = createSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'Nama dan warna label wajib diisi' }, { status: 400 })
  return NextResponse.json(await prisma.label.create({ data: parsed.data }))
}

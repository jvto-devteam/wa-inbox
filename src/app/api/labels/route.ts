import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { parseJsonBody } from '@/lib/parse-json'

export async function GET() {
  return NextResponse.json(await prisma.label.findMany())
}

const createSchema = z.object({ name: z.string().min(1), color: z.string().min(1) })

export async function POST(req: Request) {
  const parsed = await parseJsonBody(req, createSchema, 'Nama dan warna label wajib diisi')
  if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 })
  return NextResponse.json(await prisma.label.create({ data: parsed.data }))
}

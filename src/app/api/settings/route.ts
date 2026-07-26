import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'

export async function GET() {
  const settings = await prisma.settings.findUniqueOrThrow({ where: { id: 1 } })
  return NextResponse.json(settings)
}

const patchSchema = z.object({
  defaultChannel: z.enum(['OFFICIAL', 'UNOFFICIAL']).optional(),
  workingHoursStart: z.string().optional(),
  workingHoursEnd: z.string().optional(),
  offHoursAutoReply: z.string().optional(),
})

export async function PATCH(req: Request) {
  const parsed = patchSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'Data pengaturan tidak valid' }, { status: 400 })
  const settings = await prisma.settings.update({ where: { id: 1 }, data: parsed.data })
  return NextResponse.json(settings)
}

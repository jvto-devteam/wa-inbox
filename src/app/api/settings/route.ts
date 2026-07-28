import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/require-admin'
import { parseJsonBody } from '@/lib/parse-json'

// GET stays open to every authenticated user: the inbox and settings pages
// both read defaultChannel/working hours, and agents need them.
export async function GET() {
  const settings = await prisma.settings.findUniqueOrThrow({ where: { id: 1 } })
  return NextResponse.json(settings)
}

const patchSchema = z.object({
  defaultChannel: z.enum(['OFFICIAL', 'UNOFFICIAL']).optional(),
  workingHoursStart: z.string().optional(),
  workingHoursEnd: z.string().optional(),
  offHoursAutoReply: z.string().optional(),
  // Which model within each already-fixed provider src/lib/bot/llm.ts uses -- not a
  // provider switch (see the Settings.ollamaModel/openaiModel schema comment).
  ollamaModel: z.string().min(1).optional(),
  openaiModel: z.string().min(1).optional(),
})

// Writing settings is admin-only. The Settings page already disables the
// working-hours inputs for non-admins, but that is presentation, not
// authorization — anyone could PATCH this endpoint directly and change the
// default send channel or the off-hours auto-reply for the whole company.
export async function PATCH(req: Request) {
  const admin = await requireAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Hanya admin yang bisa mengubah pengaturan' }, { status: 403 })

  const parsed = await parseJsonBody(req, patchSchema, 'Data pengaturan tidak valid')
  if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const settings = await prisma.settings.update({ where: { id: 1 }, data: parsed.data })
  return NextResponse.json(settings)
}

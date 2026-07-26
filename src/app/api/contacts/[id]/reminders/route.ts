import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const reminders = await prisma.reminder.findMany({
    where: { contactId: id },
    orderBy: { dueAt: 'asc' },
  })
  return NextResponse.json(reminders)
}

const createSchema = z.object({ dueAt: z.string(), note: z.string().min(1) })

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const parsed = createSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'Tanggal dan catatan reminder wajib diisi' }, { status: 400 })

  const reminder = await prisma.reminder.create({
    data: { contactId: id, dueAt: new Date(parsed.data.dueAt), note: parsed.data.note },
  })
  return NextResponse.json(reminder)
}

const patchSchema = z.object({ reminderId: z.string(), done: z.boolean() })

// `reminderId` is globally unique (cuid), so `prisma.reminder.update({ where: { id } })` alone
// would happily flip the `done` flag on a reminder belonging to a different contact if the
// client sent a mismatched `contactId`/`reminderId` pair. Since this route is scoped by
// contactId (`/api/contacts/:id/reminders`), we check ownership first and 404 on a mismatch
// as a defense-in-depth guard against a buggy or malicious client.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const parsed = patchSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'reminderId dan done wajib diisi' }, { status: 400 })

  const existing = await prisma.reminder.findUnique({ where: { id: parsed.data.reminderId } })
  if (!existing || existing.contactId !== id) {
    return NextResponse.json({ error: 'Reminder tidak ditemukan' }, { status: 404 })
  }

  const reminder = await prisma.reminder.update({
    where: { id: parsed.data.reminderId },
    data: { done: parsed.data.done },
  })
  return NextResponse.json(reminder)
}

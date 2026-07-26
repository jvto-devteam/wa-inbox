import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const template = await prisma.template.findUnique({ where: { id } })
  if (!template) return NextResponse.json({ error: 'Template tidak ditemukan' }, { status: 404 })
  return NextResponse.json(template)
}

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  category: z.string().optional(),
  body: z.string().min(1).optional(),
})

// A QUICK_REPLY template is purely local (used for compose-box shortcuts), so its
// name/category/body can be edited freely — nothing external depends on its content.
//
// An OFFICIAL template that has already been submitted to Meta (metaStatus !== NOT_APPLICABLE,
// which in practice is every stored OFFICIAL row since POST always submits immediately) cannot
// have its content edited here: Meta's real Graph API does not support mutating an
// already-submitted template's name/category/body — the only way to change it is to submit a
// new template (a new name/version), which is a create, not an update. Silently allowing PATCH
// to rewrite the local row would desync it from what Meta actually approved/rejected. So we
// reject with 409 and let the operator create a new template instead.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const parsed = patchSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'Data template tidak valid' }, { status: 400 })

  const existing = await prisma.template.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Template tidak ditemukan' }, { status: 404 })

  if (existing.type === 'OFFICIAL' && existing.metaStatus !== 'NOT_APPLICABLE') {
    return NextResponse.json(
      { error: 'Template resmi yang sudah dikirim ke Meta tidak dapat diedit. Buat template baru sebagai gantinya.' },
      { status: 409 }
    )
  }

  const template = await prisma.template.update({ where: { id }, data: parsed.data })
  return NextResponse.json(template)
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await prisma.template.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/require-admin'
import { deleteMetaTemplate } from '@/lib/meta/templates'

// GET stays open — agents read templates to use them in the compose box.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const template = await prisma.template.findUnique({ where: { id } })
  if (!template) return NextResponse.json({ error: 'Template tidak ditemukan' }, { status: 404 })
  return NextResponse.json(template)
}

// Admin-only: templates are a shared resource, and a deletion silently removes
// a reply other agents depend on with no way to undo it.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Hanya admin yang bisa menghapus template' }, { status: 403 })

  const { id } = await params
  const existing = await prisma.template.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Template tidak ditemukan' }, { status: 404 })

  // An OFFICIAL template that actually reached Meta (metaId set) must be deleted there too --
  // otherwise it keeps existing (and keeps being sendable) on Meta after wa-inbox's own row is
  // gone, and its name stays reserved for 30 days with no obvious reason why a resubmission
  // under the same name fails. A QUICK_REPLY template never left this database, so there is
  // nothing to delete on Meta's side. On Meta failure, the local row is deliberately left in
  // place too -- the same "never let local and Meta state diverge" rule POST already follows --
  // so the admin can retry instead of silently losing track of a template that still exists.
  if (existing.type === 'OFFICIAL' && existing.metaId) {
    try {
      const waNumber = await prisma.waNumber.findFirstOrThrow()
      await deleteMetaTemplate(waNumber, existing.name)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Gagal menghapus template di Meta'
      return NextResponse.json({ error: message }, { status: 502 })
    }
  }

  await prisma.template.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}

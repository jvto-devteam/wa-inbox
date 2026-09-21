import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/require-admin'
import { parseJsonBody } from '@/lib/parse-json'
import { writeBotAuditLog } from '@/lib/bot-control/audit'
import { validateTemplateBody } from '@/lib/system-templates/render'
import { parseVariables } from '@/lib/system-templates/types'

/**
 * PATCH /api/system-templates/[key] — edit → save → live (CLAUDE.md §3). The next send uses it.
 *
 * `key` is not editable: it is the contract javavolcano-touroperator and new-backoffice call
 * by, and renaming it would break every send site at once. Nor is creating or deleting one, for
 * the same reason — keys come from scripts/seed-system-templates.ts, in step with the code that
 * calls them.
 *
 * Variables are editable (the operator may want an example or description changed, or a
 * variable made optional), but only for names the template already has: a NEW name would be a
 * value no caller sends, so a line using it could never render.
 */
const variableSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]*$/),
  required: z.boolean(),
  example: z.string().max(500).optional(),
  description: z.string().max(500).optional(),
})

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(1000).nullable().optional(),
    body: z.string().max(4000).optional(),
    imageUrl: z.string().trim().url().max(1000).nullable().optional(),
    variables: z.array(variableSchema).max(40).optional(),
    isActive: z.boolean().optional(),
  })
  .strict()

export async function PATCH(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const admin = await requireAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Hanya admin yang bisa mengubah template sistem' }, { status: 403 })

  const { key } = await params
  const parsed = await parseJsonBody(req, patchSchema, 'Data template sistem tidak valid')
  if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 })

  try {
    const existing = await prisma.systemTemplate.findUnique({ where: { key } })
    if (!existing) return NextResponse.json({ error: 'Template sistem tidak ditemukan' }, { status: 404 })

    const currentVariables = parseVariables(existing.variables)
    const variables = parsed.data.variables ?? currentVariables

    const known = new Set(currentVariables.map((variable) => variable.name))
    const unknown = variables.filter((variable) => !known.has(variable.name)).map((variable) => variable.name)
    if (unknown.length > 0) {
      return NextResponse.json(
        { error: `Variabel baru tidak bisa ditambahkan dari sini (belum dikirim program pemanggil): ${unknown.join(', ')}` },
        { status: 400 }
      )
    }
    if (new Set(variables.map((variable) => variable.name)).size !== variables.length) {
      return NextResponse.json({ error: 'Nama variabel tidak boleh dobel' }, { status: 400 })
    }

    const body = parsed.data.body ?? existing.body
    const problems = validateTemplateBody(body, variables)
    if (problems.length > 0) return NextResponse.json({ error: problems.join(' ') }, { status: 400 })

    const updated = await prisma.systemTemplate.update({
      where: { key },
      data: { ...parsed.data, variables, updatedById: admin.accountId },
    })

    const actor = await prisma.account.findUnique({ where: { id: admin.accountId }, select: { name: true } })
    const toggled = parsed.data.isActive !== undefined && parsed.data.isActive !== existing.isActive
    await writeBotAuditLog({
      action: toggled ? (parsed.data.isActive ? 'ENABLE' : 'DISABLE') : 'UPDATE',
      entityType: 'SYSTEM_TEMPLATE',
      entityId: updated.id,
      entityKey: key,
      actorId: admin.accountId,
      actorName: actor?.name ?? null,
    })

    return NextResponse.json({
      ...updated,
      variables: parseVariables(updated.variables),
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    })
  } catch (error) {
    console.error('PATCH /api/system-templates/[key] gagal', error)
    return NextResponse.json({ error: 'Gagal menyimpan template sistem' }, { status: 500 })
  }
}

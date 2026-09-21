import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/require-admin'
import { parseVariables } from '@/lib/system-templates/types'

// Admin-only, like editing: these are the messages other programs send customers, hotels and
// crew, and there is nothing an agent does in the Inbox that needs them.
export async function GET(req: Request) {
  const admin = await requireAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Hanya admin yang bisa melihat template sistem' }, { status: 403 })

  try {
    const templates = await prisma.systemTemplate.findMany({ orderBy: [{ audience: 'asc' }, { key: 'asc' }] })
    return NextResponse.json({
      items: templates.map((template) => ({
        ...template,
        variables: parseVariables(template.variables),
        createdAt: template.createdAt.toISOString(),
        updatedAt: template.updatedAt.toISOString(),
      })),
    })
  } catch (error) {
    console.error('GET /api/system-templates gagal', error)
    return NextResponse.json({ error: 'Gagal memuat template sistem' }, { status: 500 })
  }
}

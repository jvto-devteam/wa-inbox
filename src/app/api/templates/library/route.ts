import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/require-admin'
import { getTemplateLibrary } from '@/lib/meta/templates'

// Admin-only, matching /api/templates POST -- browsing is a drafting aid for the same
// admin-only template-creation flow, not a general-purpose Meta lookup.
export async function GET(req: Request) {
  const admin = await requireAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Hanya admin yang bisa menjelajahi template siap pakai' }, { status: 403 })

  const url = new URL(req.url)
  const waNumber = await prisma.waNumber.findFirstOrThrow()
  try {
    const result = await getTemplateLibrary(waNumber.accessToken, {
      category: url.searchParams.get('category') ?? undefined,
      language: url.searchParams.get('language') ?? undefined,
      nameOrContent: url.searchParams.get('q') ?? undefined,
      after: url.searchParams.get('after') ?? undefined,
    })
    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Gagal memuat template siap pakai dari Meta'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}

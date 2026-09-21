import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/require-admin'

/**
 * Revokes a key for good. There is no un-revoke: a key worth revoking may have leaked, and the
 * fix is a new key, created with POST /api/api-clients and put in the calling program's .env.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Hanya admin yang bisa mencabut API client' }, { status: 403 })

  const { id } = await params
  try {
    const client = await prisma.apiClient.findUnique({ where: { id }, select: { id: true, revokedAt: true } })
    if (!client) return NextResponse.json({ error: 'API client tidak ditemukan' }, { status: 404 })
    if (client.revokedAt) return NextResponse.json({ error: 'API client sudah dicabut' }, { status: 409 })

    const revoked = await prisma.apiClient.update({
      where: { id },
      data: { revokedAt: new Date() },
      select: { id: true, name: true, keyPrefix: true, lastUsedAt: true, revokedAt: true, createdAt: true },
    })
    return NextResponse.json(revoked)
  } catch (error) {
    console.error('POST /api/api-clients/[id]/revoke gagal', error)
    return NextResponse.json({ error: 'Gagal mencabut API client' }, { status: 500 })
  }
}

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'

/**
 * Menandai satu gap selesai. Dipakai tombol "Sudah sesuai" di panel perbaikan (setelah uji
 * ulang) dan tombol "Tandai selesai" di halaman gap.
 *
 * Idempoten: gap yang sudah selesai dikembalikan apa adanya, tanpa memindahkan stempel
 * waktunya -- kapan sesuatu dinyatakan beres adalah fakta yang tidak boleh ditulis ulang oleh
 * klik kedua.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 })

  const { id } = await params

  try {
    const existing = await prisma.knowledgeGapLog.findUnique({ where: { id }, select: { id: true, resolvedAt: true } })
    if (!existing) return NextResponse.json({ error: 'Gap tidak ditemukan.' }, { status: 404 })
    if (existing.resolvedAt) {
      return NextResponse.json({ id: existing.id, resolvedAt: existing.resolvedAt.toISOString() })
    }

    const saved = await prisma.knowledgeGapLog.update({
      where: { id },
      data: { resolvedAt: new Date() },
      select: { id: true, resolvedAt: true },
    })
    return NextResponse.json({ id: saved.id, resolvedAt: saved.resolvedAt?.toISOString() ?? null })
  } catch (error) {
    console.error('POST /api/inbox/gaps/[id]/resolve gagal', error)
    return NextResponse.json({ error: 'Gagal menandai gap selesai' }, { status: 500 })
  }
}

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'
import { readKnowledgeBody } from '@/lib/bot-control/knowledge-body'
import { MANAGED_SOURCE_TYPE } from '@/lib/bot-control/knowledge-workflow'

/**
 * Isi revisi PUBLISHED terkini satu entri, untuk panel perbaikan di Inbox. Terbuka untuk semua
 * yang login: yang dibaca adalah apa yang bot sudah katakan ke pelanggan, bukan draft.
 */
export async function GET(req: Request, { params }: { params: Promise<{ sourceId: string }> }) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 })

  const { sourceId } = await params

  try {
    const revision = await prisma.knowledgeRevision.findFirst({
      where: {
        knowledgeSourceId: sourceId,
        status: 'PUBLISHED',
        knowledgeSource: { type: MANAGED_SOURCE_TYPE, status: { not: 'ARCHIVED' } },
      },
      orderBy: { version: 'desc' },
      select: { title: true, summary: true, body: true, version: true },
    })
    if (!revision) return NextResponse.json({ error: 'Entri knowledge aktif tidak ditemukan' }, { status: 404 })

    const body = readKnowledgeBody(revision.body)
    if (!body) {
      return NextResponse.json({ error: 'Isi entri ini tidak terbaca oleh versi aplikasi ini' }, { status: 422 })
    }

    return NextResponse.json({ title: revision.title, summary: revision.summary, items: body.items, version: revision.version })
  } catch (error) {
    console.error('GET /api/inbox/knowledge/[sourceId] gagal', error)
    return NextResponse.json({ error: 'Gagal memuat entri knowledge' }, { status: 500 })
  }
}

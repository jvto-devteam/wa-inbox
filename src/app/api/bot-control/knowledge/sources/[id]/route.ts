import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'
import { readKnowledgeBody } from '@/lib/bot-control/knowledge-body'
import { MANAGED_SOURCE_TYPE } from '@/lib/bot-control/knowledge-workflow'

/**
 * GET /api/bot-control/knowledge/sources/[id] — one source with the content of its latest
 * revision, which is what the editor opens.
 *
 * The body is served only for MANAGED sources. A catalog mirror's content lives in its chunks
 * (and on disk); it has no revision to open, and pretending otherwise would offer an editor for
 * something the next `sync` would overwrite.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 })

  const { id } = await params

  try {
    const source = await prisma.knowledgeSource.findUnique({
      where: { id },
      include: { revisions: { orderBy: { version: 'desc' }, take: 1 } },
    })
    if (!source) return NextResponse.json({ error: 'Sumber knowledge tidak ditemukan' }, { status: 404 })

    const latest = source.revisions[0] ?? null
    // A body this build cannot parse comes back as null rather than as raw Json. The editor
    // would otherwise render a shape it cannot map onto its fields and silently drop the parts
    // it did not understand on the next save.
    const body = latest ? readKnowledgeBody(latest.body) : null

    return NextResponse.json({
      id: source.id,
      key: source.key,
      title: source.title,
      type: source.type,
      managed: source.type === MANAGED_SOURCE_TYPE,
      status: source.status,
      summary: source.summary,
      sourcePath: source.sourcePath,
      ownerId: source.ownerId,
      latestRevision: latest
        ? {
            id: latest.id,
            version: latest.version,
            status: latest.status,
            title: latest.title,
            summary: latest.summary,
            changeReason: latest.changeReason,
            body,
            bodyUnreadable: body === null,
          }
        : null,
    })
  } catch (error) {
    console.error('GET /api/bot-control/knowledge/sources/[id] gagal', error)
    return NextResponse.json({ error: 'Gagal memuat sumber knowledge' }, { status: 500 })
  }
}

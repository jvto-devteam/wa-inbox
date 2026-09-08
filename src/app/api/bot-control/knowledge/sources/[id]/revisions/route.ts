import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'
import { readPaging } from '@/lib/bot-control/paging'

/**
 * GET /api/bot-control/knowledge/sources/[id]/revisions — the source's full history.
 *
 * Read-only for any signed-in user, matching the rest of Bot Control. This is the answer to
 * "what did the bot know last Tuesday", which is exactly why revisions are rows rather than a
 * column that gets overwritten.
 *
 * Bodies are NOT included. A history list exists to show WHICH versions there were and what
 * changed hands when; sending every version's full prose would make the panel grow without
 * bound on a source that has been edited fifty times.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 })

  const { id } = await params
  // Capped like every other list. A source edited two hundred times would otherwise return two
  // hundred rows in one response, and the panel that renders them grows without bound.
  const { page, limit, skip } = readPaging(new URL(req.url))

  try {
    const source = await prisma.knowledgeSource.findUnique({
      where: { id },
      select: { id: true, key: true, title: true, type: true, status: true, ownerId: true },
    })
    if (!source) return NextResponse.json({ error: 'Sumber knowledge tidak ditemukan' }, { status: 404 })

    const revisions = await prisma.knowledgeRevision.findMany({
      where: { knowledgeSourceId: id },
      orderBy: { version: 'desc' },
      skip,
      take: limit,
      select: {
        id: true,
        version: true,
        title: true,
        summary: true,
        status: true,
        changeReason: true,
        createdBy: true,
        publishedBy: true,
        publishedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    // One lookup for every actor on the page, not one per row.
    const actorIds = [
      ...new Set(revisions.flatMap((r) => [r.createdBy, r.publishedBy]).filter((v): v is string => v !== null)),
    ]
    const accounts =
      actorIds.length === 0
        ? []
        : await prisma.account.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })
    const nameById = new Map(accounts.map((a) => [a.id, a.name]))

    const total = await prisma.knowledgeRevision.count({ where: { knowledgeSourceId: id } })

    return NextResponse.json({
      source,
      page,
      limit,
      total,
      revisions: revisions.map((revision) => ({
        id: revision.id,
        version: revision.version,
        title: revision.title,
        summary: revision.summary,
        status: revision.status,
        changeReason: revision.changeReason,
        // Null when the account is gone. The revision outlives whoever wrote it.
        createdByName: revision.createdBy ? nameById.get(revision.createdBy) ?? null : null,
        // "Who turned this on, and when" is what survived the removal of reviewer and approver.
        publishedByName: revision.publishedBy ? nameById.get(revision.publishedBy) ?? null : null,
        publishedAt: revision.publishedAt?.toISOString() ?? null,
        createdAt: revision.createdAt.toISOString(),
        updatedAt: revision.updatedAt.toISOString(),
      })),
    })
  } catch (error) {
    console.error('GET /api/bot-control/knowledge/sources/[id]/revisions gagal', error)
    return NextResponse.json({ error: 'Gagal memuat riwayat revisi' }, { status: 500 })
  }
}

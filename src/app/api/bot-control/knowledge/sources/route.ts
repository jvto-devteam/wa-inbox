import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'
import { readPaging } from '@/lib/bot-control/paging'

/**
 * GET /api/bot-control/knowledge/sources — the indexed catalog files.
 *
 * Read-only for any signed-in user (guidebook §19: AGENT read-only across Bot Control).
 *
 * Every filter is a `where` clause, never a `.filter()` after the query. Filtering after
 * `take` means "the first 50 rows, of which the matching ones", which is legitimately empty
 * while matching rows exist — the same bug src/app/api/bot/decisions/route.ts documents.
 */
export async function GET(req: Request) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 })

  const url = new URL(req.url)
  const { page, limit, skip } = readPaging(url)
  const q = url.searchParams.get('q')?.trim()
  const type = url.searchParams.get('type')?.trim()
  const status = url.searchParams.get('status')?.trim()
  const topic = url.searchParams.get('topic')?.trim()

  const where: Prisma.KnowledgeSourceWhereInput = {}
  if (type) where.type = type
  if (status) where.status = status
  if (q) {
    where.OR = [
      { title: { contains: q, mode: 'insensitive' } },
      { key: { contains: q, mode: 'insensitive' } },
      { summary: { contains: q, mode: 'insensitive' } },
    ]
  }
  // Filtering sources by topic means "sources that own at least one chunk on this topic" —
  // a relation filter, because topic lives on the chunk, not the source.
  if (topic) where.chunks = { some: { topic } }

  try {
    const [items, total] = await Promise.all([
      prisma.knowledgeSource.findMany({
        where,
        orderBy: { key: 'asc' },
        skip,
        take: limit,
        include: { _count: { select: { chunks: true } } },
      }),
      prisma.knowledgeSource.count({ where }),
    ])

    return NextResponse.json({
      items: items.map((source) => ({
        id: source.id,
        key: source.key,
        title: source.title,
        type: source.type,
        sourcePath: source.sourcePath,
        status: source.status,
        summary: source.summary,
        metadata: source.metadata,
        chunkCount: source._count.chunks,
        lastSyncedAt: source.lastSyncedAt?.toISOString() ?? null,
      })),
      page,
      limit,
      total,
    })
  } catch (error) {
    console.error('GET /api/bot-control/knowledge/sources gagal', error)
    return NextResponse.json({ error: 'Gagal memuat sumber knowledge' }, { status: 500 })
  }
}

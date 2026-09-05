import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'
import { readPaging } from '@/lib/bot-control/paging'

/** Body text shown in the list. The full body stays available in the detail panel. */
const BODY_PREVIEW_LENGTH = 400

/**
 * GET /api/bot-control/knowledge/chunks — the indexed content, searchable.
 *
 * `sourceId` narrows to one file; `q` searches title and body; `topic` filters by the topic
 * the indexer derived from the file path. All three are `where` clauses so paging stays
 * consistent with the count.
 */
export async function GET(req: Request) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 })

  const url = new URL(req.url)
  const { page, limit, skip } = readPaging(url)
  const sourceId = url.searchParams.get('sourceId')?.trim()
  const q = url.searchParams.get('q')?.trim()
  const topic = url.searchParams.get('topic')?.trim()

  const where: Prisma.KnowledgeChunkWhereInput = {}
  if (sourceId) where.knowledgeSourceId = sourceId
  if (topic) where.topic = topic
  if (q) {
    where.OR = [
      { title: { contains: q, mode: 'insensitive' } },
      { body: { contains: q, mode: 'insensitive' } },
    ]
  }

  try {
    const [items, total] = await Promise.all([
      prisma.knowledgeChunk.findMany({
        where,
        // Ordered by title within topic so a filtered list reads as a grouped table rather
        // than in cuid order, which is effectively random to a human.
        orderBy: [{ topic: 'asc' }, { title: 'asc' }],
        skip,
        take: limit,
        include: { knowledgeSource: { select: { key: true, title: true, sourcePath: true } } },
      }),
      prisma.knowledgeChunk.count({ where }),
    ])

    return NextResponse.json({
      items: items.map((chunk) => ({
        id: chunk.id,
        knowledgeSourceId: chunk.knowledgeSourceId,
        sourceKey: chunk.knowledgeSource.key,
        sourcePath: chunk.knowledgeSource.sourcePath,
        topic: chunk.topic,
        title: chunk.title,
        bodyPreview: chunk.body.slice(0, BODY_PREVIEW_LENGTH),
        body: chunk.body,
        facts: chunk.facts,
        links: chunk.links,
        prices: chunk.prices,
        tags: chunk.tags,
        // Counts are precomputed here rather than in the browser: the UI columns the guidebook
        // specifies (§10.2) are "links count" and "prices count", and deriving them client-side
        // would mean every consumer re-implementing the same null handling for a Json column.
        linksCount: Array.isArray(chunk.links) ? chunk.links.length : 0,
        pricesCount: Array.isArray(chunk.prices) ? chunk.prices.length : 0,
        hash: chunk.hash,
      })),
      page,
      limit,
      total,
    })
  } catch (error) {
    console.error('GET /api/bot-control/knowledge/chunks gagal', error)
    return NextResponse.json({ error: 'Gagal memuat isi knowledge' }, { status: 500 })
  }
}

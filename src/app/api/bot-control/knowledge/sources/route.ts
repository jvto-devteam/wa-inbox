import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'
import { parseJsonBody } from '@/lib/parse-json'
import { readPaging } from '@/lib/bot-control/paging'
import { sessionCan } from '@/lib/bot-control/permissions'
import {
  createManagedKnowledge,
  KnowledgeNotEditableError,
  MANAGED_SOURCE_TYPE,
  SOURCE_LIFECYCLES,
} from '@/lib/bot-control/knowledge-workflow'

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
  const lifecycle = url.searchParams.get('lifecycle')?.trim()
  const ownerId = url.searchParams.get('ownerId')?.trim()
  const hasDraft = url.searchParams.get('hasDraft')

  const where: Prisma.KnowledgeSourceWhereInput = {}
  if (type) where.type = type
  if (status) where.status = status
  // `lifecycle` and `status` are the SAME column, deliberately. The SDD sketches lifecycle as a
  // new field, but KnowledgeSource.status already holds exactly these values and is already
  // written by the indexer's archiving. A second state column would give every row two
  // opinions about whether it is live, and they would drift the first time one writer forgot
  // the other. `lifecycle` is kept as the query name because that is what the SDD's UI asks for.
  if (lifecycle && (SOURCE_LIFECYCLES as readonly string[]).includes(lifecycle)) where.status = lifecycle
  if (ownerId) where.ownerId = ownerId
  // "Has something pending" means a revision that is not yet published and not yet discarded.
  if (hasDraft === 'true') where.revisions = { some: { status: { in: ['DRAFT', 'REVIEW', 'APPROVED'] } } }
  if (hasDraft === 'false') where.revisions = { none: { status: { in: ['DRAFT', 'REVIEW', 'APPROVED'] } } }
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
        include: {
          _count: { select: { chunks: true } },
          // Newest first: the row's headline state is its latest revision, not its first.
          revisions: { orderBy: { version: 'desc' }, take: 1, select: { id: true, version: true, status: true } },
        },
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
        ownerId: source.ownerId,
        // A catalog mirror has no revisions and never will; saying so lets the UI render the
        // right controls without having to infer it from the type string.
        managed: source.type === MANAGED_SOURCE_TYPE,
        latestRevision: source.revisions[0]
          ? {
              id: source.revisions[0].id,
              version: source.revisions[0].version,
              status: source.revisions[0].status,
            }
          : null,
        hasDraft: source.revisions[0]
          ? ['DRAFT', 'REVIEW', 'APPROVED'].includes(source.revisions[0].status)
          : false,
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

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  summary: z.string().trim().max(1000).optional(),
  // Shape validated against knowledge-body.ts inside the workflow — the bot reads this, so an
  // item missing its answer is not a layout bug, it is a customer being told `undefined`.
  body: z.unknown(),
  reason: z.string().trim().min(10).max(2000),
})

/**
 * POST /api/bot-control/knowledge/sources — create a managed knowledge source.
 *
 * Always creates it as a DRAFT with a first revision, never published. The bot does not read
 * it until a release publishes it, which is the same path rules take (SDD Manage Second §11).
 */
export async function POST(req: Request) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 })
  if (!sessionCan(session, 'EDIT_KNOWLEDGE_DRAFT')) {
    return NextResponse.json({ error: 'Peran Anda tidak boleh membuat knowledge' }, { status: 403 })
  }

  const parsed = await parseJsonBody(req, createSchema, 'Data knowledge tidak valid; alasan wajib minimal 10 karakter')
  if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 })

  try {
    const actor = await prisma.account.findUnique({ where: { id: session.accountId }, select: { name: true } })
    const result = await createManagedKnowledge(
      {
        title: parsed.data.title,
        summary: parsed.data.summary ?? null,
        body: parsed.data.body,
        reason: parsed.data.reason,
      },
      { id: session.accountId, name: actor?.name ?? null },
      req
    )
    return NextResponse.json(result)
  } catch (error) {
    // 400: the content itself is what is wrong, and the message names the offending field.
    if (error instanceof KnowledgeNotEditableError) return NextResponse.json({ error: error.message }, { status: 400 })
    console.error('POST /api/bot-control/knowledge/sources gagal', error)
    return NextResponse.json({ error: 'Gagal membuat knowledge' }, { status: 500 })
  }
}

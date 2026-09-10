import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'
import { parseJsonBody } from '@/lib/parse-json'
import { readPaging } from '@/lib/bot-control/paging'
import { hasAdminPowers } from '@/lib/bot-control/permissions'
import { topicsOfBody } from '@/lib/bot-control/knowledge-body'
import {
  createManagedKnowledge,
  KnowledgeNotEditableError,
  MANAGED_SOURCE_TYPE,
  SOURCE_LIFECYCLES,
} from '@/lib/bot-control/knowledge-workflow'

/**
 * GET /api/bot-control/knowledge/sources — the operator-written knowledge sources.
 *
 * Read-only for any signed-in user (guidebook §19: AGENT read-only across Bot Control).
 *
 * Every row here is `type='MANUAL'` now. This list used to also carry one row per
 * `catalog/*.json` file — a mirror the bot never read — together with its chunk count, file
 * path and last-sync time. The catalog is read straight from disk by
 * `/api/bot-control/knowledge/catalog`, so those columns and the `type`/`topic` filters that
 * only made sense against the mirror are gone.
 *
 * Every filter is a `where` clause, never a `.filter()` after the query. Filtering after
 * `take` means "the first 50 rows, of which the matching ones", which is legitimately empty
 * while matching rows exist, so every filter has to reach the database.
 */
export async function GET(req: Request) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 })

  const url = new URL(req.url)
  const { page, limit, skip } = readPaging(url)
  const q = url.searchParams.get('q')?.trim()
  const status = url.searchParams.get('status')?.trim()
  const lifecycle = url.searchParams.get('lifecycle')?.trim()
  const ownerId = url.searchParams.get('ownerId')?.trim()
  const hasDraft = url.searchParams.get('hasDraft')

  const where: Prisma.KnowledgeSourceWhereInput = {}
  if (status) where.status = status
  // `lifecycle` and `status` are the SAME column, deliberately. The SDD sketches lifecycle as a
  // new field, but KnowledgeSource.status already holds exactly these values. A second state
  // column would give every row two opinions about whether it is live, and they would drift the
  // first time one writer forgot the other. `lifecycle` is kept as the query name because that
  // is what the SDD's UI asks for.
  if (lifecycle && (SOURCE_LIFECYCLES as readonly string[]).includes(lifecycle)) where.status = lifecycle
  if (ownerId) where.ownerId = ownerId
  // "Has something pending" means a revision written but not yet activated.
  if (hasDraft === 'true') where.revisions = { some: { status: 'DRAFT' } }
  if (hasDraft === 'false') where.revisions = { none: { status: 'DRAFT' } }
  if (q) {
    where.OR = [
      { title: { contains: q, mode: 'insensitive' } },
      { key: { contains: q, mode: 'insensitive' } },
      { summary: { contains: q, mode: 'insensitive' } },
    ]
  }

  try {
    const [items, total] = await Promise.all([
      prisma.knowledgeSource.findMany({
        where,
        orderBy: { key: 'asc' },
        skip,
        take: limit,
        include: {
          // Newest first: the row's headline state is its latest revision, not its first.
          // `body: true` is selected ONLY to derive `topics` below — the body itself is never
          // put on the response; see the header comment on `knowledge-body.ts` for why bodies
          // stay off list responses.
          revisions: {
            orderBy: { version: 'desc' },
            take: 1,
            select: { id: true, version: true, status: true, body: true },
          },
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
        status: source.status,
        summary: source.summary,
        ownerId: source.ownerId,
        // Kept even though every row is managed today: the guard in knowledge-workflow.ts keys
        // on the type, and a client that infers "editable" from the row's mere presence would
        // stop agreeing with the API the moment a second type exists again.
        managed: source.type === MANAGED_SOURCE_TYPE,
        latestRevision: source.revisions[0]
          ? {
              id: source.revisions[0].id,
              version: source.revisions[0].version,
              status: source.revisions[0].status,
            }
          : null,
        hasDraft: source.revisions[0]?.status === 'DRAFT',
        // Derived from the latest revision's body, never the body itself — at most 14 values.
        topics: source.revisions[0] ? topicsOfBody(source.revisions[0].body) : [],
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
 * Always creates it as a DRAFT with a first revision, never live. The bot does not read it
 * until somebody presses Aktifkan (`POST .../[id]/publish`).
 */
export async function POST(req: Request) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 })
  if (!hasAdminPowers(session.role)) {
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
      { id: session.accountId, name: actor?.name ?? null }
    )
    return NextResponse.json(result)
  } catch (error) {
    // 400: the content itself is what is wrong, and the message names the offending field.
    if (error instanceof KnowledgeNotEditableError) return NextResponse.json({ error: error.message }, { status: 400 })
    console.error('POST /api/bot-control/knowledge/sources gagal', error)
    return NextResponse.json({ error: 'Gagal membuat knowledge' }, { status: 500 })
  }
}

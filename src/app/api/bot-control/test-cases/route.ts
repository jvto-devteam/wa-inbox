import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'
import { parseJsonBody } from '@/lib/parse-json'
import { readPaging } from '@/lib/bot-control/paging'
import { sessionCan } from '@/lib/bot-control/permissions'
import { SIMULATION_STATUSES } from '@/lib/bot-control/test-runner'

/**
 * GET  /api/bot-control/test-cases — the saved suite.
 * POST /api/bot-control/test-cases — save one, usually straight from a simulation.
 *
 * Creating a test case is open to an AGENT (SDD Manage Second §13). That is deliberate and not
 * an oversight: the person who notices the bot answering wrongly is the agent reading the
 * conversation, and making them file a ticket for someone else to write the case is how the
 * case never gets written.
 */
export async function GET(req: Request) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 })

  const url = new URL(req.url)
  const { page, limit, skip } = readPaging(url)

  const where: Prisma.BotTestCaseWhereInput = {}
  const category = url.searchParams.get('category')?.trim()
  const enabled = url.searchParams.get('enabled')
  const q = url.searchParams.get('q')?.trim()

  if (category) where.category = category
  if (enabled === 'true') where.enabled = true
  if (enabled === 'false') where.enabled = false
  if (q) {
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { inputText: { contains: q, mode: 'insensitive' } },
      { description: { contains: q, mode: 'insensitive' } },
    ]
  }

  try {
    const [items, total, categories] = await Promise.all([
      prisma.botTestCase.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit }),
      prisma.botTestCase.count({ where }),
      // Whole-suite categories, not the filtered page's: a dropdown that loses its own options
      // once you pick one cannot be used to pick a different one.
      prisma.botTestCase.findMany({ distinct: ['category'], select: { category: true } }),
    ])

    return NextResponse.json({
      items: items.map(serialize),
      categories: categories.map((row) => row.category).filter((value): value is string => value !== null),
      page,
      limit,
      total,
    })
  } catch (error) {
    console.error('GET /api/bot-control/test-cases gagal', error)
    return NextResponse.json({ error: 'Gagal memuat kasus uji' }, { status: 500 })
  }
}

export const testCaseSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).optional(),
  category: z.string().trim().max(60).optional(),
  inputText: z.string().trim().min(1).max(2000),
  conversationSeed: z
    .object({ contactName: z.string().trim().max(120).optional(), contactPhone: z.string().trim().max(30).optional() })
    .strict()
    .optional(),
  // Validated against the simulator's own union rather than a free string: an expectation the
  // runner can never match would make the case permanently red for no readable reason.
  expectedStatus: z.enum(SIMULATION_STATUSES as unknown as [string, ...string[]]).optional(),
  expectedFlowKey: z.string().trim().max(60).optional(),
  expectedContains: z.string().trim().max(500).optional(),
  expectedNotContains: z.string().trim().max(500).optional(),
  expectedHandoff: z.boolean().optional(),
  requiredKnowledgeKeys: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
  enabled: z.boolean().optional(),
})

export async function POST(req: Request) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 })
  if (!sessionCan(session, 'CREATE_TEST_CASE')) {
    return NextResponse.json({ error: 'Peran Anda tidak boleh membuat kasus uji' }, { status: 403 })
  }

  const parsed = await parseJsonBody(req, testCaseSchema, 'Data kasus uji tidak valid')
  if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 })

  try {
    const created = await prisma.botTestCase.create({
      data: {
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        category: parsed.data.category ?? null,
        inputText: parsed.data.inputText,
        conversationSeed: (parsed.data.conversationSeed ?? undefined) as Prisma.InputJsonValue | undefined,
        expectedStatus: parsed.data.expectedStatus ?? null,
        expectedFlowKey: parsed.data.expectedFlowKey ?? null,
        expectedContains: parsed.data.expectedContains ?? null,
        expectedNotContains: parsed.data.expectedNotContains ?? null,
        expectedHandoff: parsed.data.expectedHandoff ?? null,
        requiredKnowledgeKeys: (parsed.data.requiredKnowledgeKeys ?? undefined) as Prisma.InputJsonValue | undefined,
        enabled: parsed.data.enabled ?? true,
        createdBy: session.accountId,
      },
    })
    return NextResponse.json(serialize(created))
  } catch (error) {
    console.error('POST /api/bot-control/test-cases gagal', error)
    return NextResponse.json({ error: 'Gagal menyimpan kasus uji' }, { status: 500 })
  }
}

type TestCaseRow = {
  id: string
  name: string
  description: string | null
  category: string | null
  inputText: string
  conversationSeed: unknown
  expectedStatus: string | null
  expectedFlowKey: string | null
  expectedContains: string | null
  expectedNotContains: string | null
  expectedHandoff: boolean | null
  requiredKnowledgeKeys: unknown
  enabled: boolean
  createdBy: string | null
  createdAt: Date
  updatedAt: Date
}

export function serialize(row: TestCaseRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category,
    inputText: row.inputText,
    conversationSeed: row.conversationSeed,
    expectedStatus: row.expectedStatus,
    expectedFlowKey: row.expectedFlowKey,
    expectedContains: row.expectedContains,
    expectedNotContains: row.expectedNotContains,
    expectedHandoff: row.expectedHandoff,
    requiredKnowledgeKeys: row.requiredKnowledgeKeys,
    enabled: row.enabled,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

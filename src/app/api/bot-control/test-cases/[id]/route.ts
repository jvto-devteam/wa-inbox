import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'
import { parseJsonBody } from '@/lib/parse-json'
import { sessionCan } from '@/lib/bot-control/permissions'
import { serialize, testCaseSchema } from '../route'

/**
 * PATCH  /api/bot-control/test-cases/[id] — edit one.
 * DELETE /api/bot-control/test-cases/[id] — disable it, or remove it outright with ?hard=true.
 */
const patchSchema = testCaseSchema.partial()

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 })
  if (!sessionCan(session, 'CREATE_TEST_CASE')) {
    return NextResponse.json({ error: 'Peran Anda tidak boleh mengubah kasus uji' }, { status: 403 })
  }

  const { id } = await params
  const parsed = await parseJsonBody(req, patchSchema, 'Data kasus uji tidak valid')
  if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 })

  try {
    const existing = await prisma.botTestCase.findUnique({ where: { id } })
    if (!existing) return NextResponse.json({ error: 'Kasus uji tidak ditemukan' }, { status: 404 })

    const data: Prisma.BotTestCaseUpdateInput = {}
    // Field by field, and only the ones actually sent. Spreading the parsed object would write
    // `undefined` over every column the caller omitted, silently clearing expectations they
    // never touched.
    if (parsed.data.name !== undefined) data.name = parsed.data.name
    if (parsed.data.description !== undefined) data.description = parsed.data.description
    if (parsed.data.category !== undefined) data.category = parsed.data.category
    if (parsed.data.inputText !== undefined) data.inputText = parsed.data.inputText
    if (parsed.data.conversationSeed !== undefined) {
      data.conversationSeed = parsed.data.conversationSeed as Prisma.InputJsonValue
    }
    if (parsed.data.expectedStatus !== undefined) data.expectedStatus = parsed.data.expectedStatus
    if (parsed.data.expectedFlowKey !== undefined) data.expectedFlowKey = parsed.data.expectedFlowKey
    if (parsed.data.expectedContains !== undefined) data.expectedContains = parsed.data.expectedContains
    if (parsed.data.expectedNotContains !== undefined) data.expectedNotContains = parsed.data.expectedNotContains
    if (parsed.data.expectedHandoff !== undefined) data.expectedHandoff = parsed.data.expectedHandoff
    if (parsed.data.requiredKnowledgeKeys !== undefined) {
      data.requiredKnowledgeKeys = parsed.data.requiredKnowledgeKeys as Prisma.InputJsonValue
    }
    if (parsed.data.enabled !== undefined) data.enabled = parsed.data.enabled

    const updated = await prisma.botTestCase.update({ where: { id }, data })
    return NextResponse.json(serialize(updated))
  } catch (error) {
    console.error('PATCH /api/bot-control/test-cases/[id] gagal', error)
    return NextResponse.json({ error: 'Gagal mengubah kasus uji' }, { status: 500 })
  }
}

/**
 * Soft by default, hard only when asked, and hard is ADMIN-only.
 *
 * Disabling keeps the case readable: it still explains what somebody once considered important,
 * and can be turned back on without being rewritten. A hard delete also orphans the
 * `BotTestResult` rows that reference it — they survive by design (the column is not a foreign
 * key), but the evidence of WHY a past release was gated becomes harder to read.
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 })
  if (!sessionCan(session, 'CREATE_TEST_CASE')) {
    return NextResponse.json({ error: 'Peran Anda tidak boleh menghapus kasus uji' }, { status: 403 })
  }

  const { id } = await params
  const hard = new URL(req.url).searchParams.get('hard') === 'true'

  if (hard && !sessionCan(session, 'APPROVE')) {
    return NextResponse.json({ error: 'Hanya admin yang bisa menghapus kasus uji secara permanen' }, { status: 403 })
  }

  try {
    const existing = await prisma.botTestCase.findUnique({ where: { id }, select: { id: true } })
    if (!existing) return NextResponse.json({ error: 'Kasus uji tidak ditemukan' }, { status: 404 })

    if (hard) {
      await prisma.botTestCase.delete({ where: { id } })
      return NextResponse.json({ id, deleted: true })
    }

    const updated = await prisma.botTestCase.update({ where: { id }, data: { enabled: false } })
    return NextResponse.json(serialize(updated))
  } catch (error) {
    console.error('DELETE /api/bot-control/test-cases/[id] gagal', error)
    return NextResponse.json({ error: 'Gagal menghapus kasus uji' }, { status: 500 })
  }
}

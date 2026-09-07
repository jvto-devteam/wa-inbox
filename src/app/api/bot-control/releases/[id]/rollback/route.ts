import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/require-admin'
import { parseJsonBody } from '@/lib/parse-json'
import {
  rollbackToRelease,
  ReleaseAlreadyActiveError,
  ReleaseNotFoundError,
  ReleaseNotRestorableError,
  ReleaseVersionConflictError,
} from '@/lib/bot-control/release'

/**
 * POST /api/bot-control/releases/[id]/rollback — restore a previous release.
 *
 * `id` names the release being RESTORED, not the one being abandoned. Rollback creates a new
 * release carrying that one's snapshot, so the history reads forwards and nothing is deleted
 * (SDD Manage Second §12).
 *
 * `reason` is required, and required to be substantive. A rollback is the most consequential
 * button in Bot Control, and it is read months later by somebody trying to understand why the
 * bot's behaviour changed — an empty reason makes the audit row a timestamp with no meaning.
 */
const bodySchema = z.object({ reason: z.string().trim().min(10).max(2000) })

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Hanya admin yang bisa melakukan rollback' }, { status: 403 })

  const { id } = await params
  const parsed = await parseJsonBody(req, bodySchema, 'Alasan rollback wajib diisi, minimal 10 karakter')
  if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 })

  try {
    const actor = await prisma.account.findUnique({ where: { id: admin.accountId }, select: { name: true } })
    const release = await rollbackToRelease({
      targetReleaseId: id,
      reason: parsed.data.reason,
      actorId: admin.accountId,
      actorName: actor?.name ?? null,
      req,
    })

    return NextResponse.json({
      id: release.id,
      version: release.version,
      title: release.title,
      status: release.status,
      publishedAt: release.publishedAt.toISOString(),
    })
  } catch (error) {
    if (error instanceof ReleaseNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 })
    // 409, not 400: the request was well-formed, the state simply makes it a no-op.
    if (error instanceof ReleaseAlreadyActiveError) return NextResponse.json({ error: error.message }, { status: 409 })
    if (error instanceof ReleaseVersionConflictError) return NextResponse.json({ error: error.message }, { status: 409 })
    // 409 with the reason spelled out: a snapshot from before rule values were recorded can be
    // read and listed, but cannot be put back — and the operator needs to know which it is.
    if (error instanceof ReleaseNotRestorableError) return NextResponse.json({ error: error.message }, { status: 409 })
    console.error('POST /api/bot-control/releases/[id]/rollback gagal', error)
    return NextResponse.json({ error: 'Gagal melakukan rollback' }, { status: 500 })
  }
}

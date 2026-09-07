import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/require-admin'
import { previewRelease } from '@/lib/bot-control/release'

/**
 * POST /api/bot-control/releases/preview — what publishing right now would do.
 *
 * A POST rather than a GET because that is what SDD Manage Second §8.5 specifies, and because
 * later phases give it a body (the set of entities an operator has selected to publish). It is
 * read-only today and writes no audit row: looking at a preview is not a change.
 *
 * Admin-only, matching publish. A preview enumerates every pending change in the account, and
 * whoever may see the whole pending set is the same person who may ship it.
 */
export async function POST(req: Request) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: 'Hanya admin yang bisa melihat preview release' }, { status: 403 })
  }

  try {
    return NextResponse.json(await previewRelease())
  } catch (error) {
    console.error('POST /api/bot-control/releases/preview gagal', error)
    return NextResponse.json({ error: 'Gagal membuat preview release' }, { status: 500 })
  }
}

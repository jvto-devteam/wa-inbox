import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/get-session'
import { collectOverview } from '@/lib/bot-control/overview'

/**
 * GET /api/bot-control/overview — the nine status cards and three data widgets of
 * guidebook §18.1.
 *
 * Read-only for any signed-in user, like the other Bot Control read endpoints (§19): an agent
 * who can see the Decision Logs can see the counts above them. Nothing here is writable, and
 * the WhatsApp credentials behind the two "configured?" cards are counted in the database
 * rather than loaded (see collectOverview), so they cannot reach this response.
 */
export async function GET(req: Request) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 })

  try {
    return NextResponse.json(await collectOverview())
  } catch (error) {
    console.error('GET /api/bot-control/overview gagal', error)
    return NextResponse.json({ error: 'Gagal memuat ringkasan Bot Control' }, { status: 500 })
  }
}

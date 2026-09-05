import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/get-session'
import { listExistingFlows } from '@/lib/bot-control/existing-flow-registry'

/**
 * GET /api/bot-control/flows — daftar flow bot yang berjalan.
 *
 * Sesi saja, bukan admin: guidebook §19 mensyaratkan AGENT bisa membaca seluruh area Bot
 * Control. Tidak ada yang rahasia di sini — hanya nama langkah dan path file, tanpa satu pun
 * kredensial.
 *
 * Sumbernya registry statis di kode, bukan tabel BotFlowDefinition. Tabel itu baru ada di fase
 * berikutnya, dan Phase 1 dilarang membuat migration.
 */
export async function GET(req: Request) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 })

  return NextResponse.json({ flows: listExistingFlows() })
}

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth/get-session'
import { hasAdminPowers } from '@/lib/bot-control/permissions'
import { parseJsonBody } from '@/lib/parse-json'
import { AI_AGENTS } from '@/lib/ai-office/activity'
import { findAction } from '@/lib/ai-office/agent-tools'

/**
 * Menjalankan tindakan yang diusulkan asisten Kantor AI, SESUDAH operator menekan "Jalankan". Nama aksi harus milik
 * asisten itu dan args divalidasi ulang di sini (usulan dari klien tidak dipercaya). Setiap aksi memanggil fungsi yang
 * sama dengan tombolnya di Inbox, dan semuanya memang terbuka untuk akun yang login di sana (kartu booking: CLAUDE.md
 * §6 pengecualian kedua; ringkas ulang, label topik, sakelar bot per chat: tanpa gerbang admin).
 */
const bodySchema = z.object({
  agent: z.enum(AI_AGENTS),
  action: z.string().min(1).max(40),
  args: z.record(z.string(), z.unknown()),
})

export async function POST(req: Request) {
  try {
    const session = await getSession(req)
    if (!session) return NextResponse.json({ error: 'Belum masuk' }, { status: 401 })
    const body = await parseJsonBody(req, bodySchema)
    if (!body.success) return NextResponse.json({ error: body.error }, { status: 400 })
    const action = findAction(body.data.agent, body.data.action)
    if (!action) return NextResponse.json({ error: 'Tindakan tidak dikenal untuk asisten ini' }, { status: 400 })
    const args = action.args.safeParse(body.data.args)
    if (!args.success) return NextResponse.json({ error: 'Data tindakan tidak valid' }, { status: 400 })
    const check = await action.describe(args.data)
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: 409 })
    const res = await action.run(args.data, { now: new Date(), isAdmin: hasAdminPowers(session.role), accountId: session.accountId })
    return NextResponse.json({ result: res.result, conversationId: res.conversationId ?? null })
  } catch (error) {
    console.error('POST /api/ai-office/action gagal', { error: error instanceof Error ? error.name : 'unknown' })
    return NextResponse.json({ error: 'Tindakan gagal dijalankan' }, { status: 500 })
  }
}

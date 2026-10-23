import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth/get-session'
import { hasAdminPowers } from '@/lib/bot-control/permissions'
import { parseJsonBody } from '@/lib/parse-json'
import { AI_AGENTS, reportAiActivity } from '@/lib/ai-office/activity'
import { AGENT_PROFILES, findAction } from '@/lib/ai-office/agent-tools'

/**
 * Menjalankan tindakan yang diusulkan asisten Kantor AI, SESUDAH operator menekan "Jalankan". Args divalidasi ulang di
 * sini (usulan dari klien tidak dipercaya). Yang mengerjakan selalu PEMILIK aksi (`owner`), siapa pun yang diajak
 * mengobrol: di kantor 3D pemiliknya yang terlihat bekerja lalu mengantar hasilnya ke admin, dan asisten yang diajak
 * mengobrol tercatat "meminta" rekannya. Setiap aksi memanggil fungsi yang
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
    const action = findAction(body.data.action)
    if (!action) return NextResponse.json({ error: 'Tindakan tidak dikenal' }, { status: 400 })
    const args = action.args.safeParse(body.data.args)
    if (!args.success) return NextResponse.json({ error: 'Data tindakan tidak valid' }, { status: 400 })
    const check = await action.describe(args.data)
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: 409 })
    const requester = body.data.agent
    const target = typeof args.data.conversationId === 'string' ? args.data.conversationId : ''
    if (requester !== action.owner) reportAiActivity(requester, 'selesai', `Meminta ${AGENT_PROFILES[action.owner].name}: ${action.activity}`, target)
    reportAiActivity(action.owner, 'mulai', action.activity, target)
    let res: Awaited<ReturnType<typeof action.run>>
    try {
      res = await action.run(args.data, { now: new Date(), isAdmin: hasAdminPowers(session.role), accountId: session.accountId })
    } catch (error) {
      reportAiActivity(action.owner, 'gagal', `Gagal: ${action.activity}`, target)
      throw error
    }
    reportAiActivity(action.owner, 'selesai', `Selesai: ${action.activity}`, res.conversationId ?? target, true)
    const by = requester === action.owner ? '' : `${AGENT_PROFILES[action.owner].name}: `
    return NextResponse.json({ result: `${by}${res.result}`, conversationId: res.conversationId ?? null })
  } catch (error) {
    console.error('POST /api/ai-office/action gagal', { error: error instanceof Error ? error.name : 'unknown' })
    return NextResponse.json({ error: 'Tindakan gagal dijalankan' }, { status: 500 })
  }
}

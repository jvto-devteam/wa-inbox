import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth/get-session'
import { hasAdminPowers } from '@/lib/bot-control/permissions'
import { parseJsonBody } from '@/lib/parse-json'
import { AI_AGENTS } from '@/lib/ai-office/activity'
import { runAgentChat } from '@/lib/ai-office/agent-chat'
import { CHAT_MAX_CHARS, CHAT_MAX_MESSAGES } from '@/lib/ai-office/chat-types'

/**
 * Obrolan operator dengan satu asisten Kantor AI (`agent-chat.ts`). Terbuka untuk semua akun yang login: alat di
 * sini hanya MEMBACA ringkasan (simulasi bot tetap khusus admin di dalam alatnya), dan tindakan yang diusulkan baru
 * dijalankan lewat `POST /api/ai-office/action`.
 */
const bodySchema = z.object({
  agent: z.enum(AI_AGENTS),
  messages: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().trim().min(1).max(CHAT_MAX_CHARS * 2) }))
    .min(1)
    .max(CHAT_MAX_MESSAGES),
})

export async function POST(req: Request) {
  try {
    const session = await getSession(req)
    if (!session) return NextResponse.json({ error: 'Belum masuk' }, { status: 401 })
    const body = await parseJsonBody(req, bodySchema)
    if (!body.success) return NextResponse.json({ error: body.error }, { status: 400 })
    const { agent, messages } = body.data
    if (messages[messages.length - 1].role !== 'user') return NextResponse.json({ error: 'Pesan terakhir harus dari operator' }, { status: 400 })
    const res = await runAgentChat(agent, messages, { now: new Date(), isAdmin: hasAdminPowers(session.role) })
    return NextResponse.json(res)
  } catch (error) {
    console.error('POST /api/ai-office/chat gagal', { error: error instanceof Error ? error.name : 'unknown' })
    return NextResponse.json({ error: 'Asisten sedang tidak bisa menjawab. Coba lagi sebentar.' }, { status: 502 })
  }
}

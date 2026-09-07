import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth/get-session'
import { requireAdmin } from '@/lib/auth/require-admin'
import { parseJsonBody } from '@/lib/parse-json'
import { writeBotAuditLog } from '@/lib/bot-control/audit'
import { resumeProvider, getPausedProviders, PAUSABLE_PROVIDERS } from '@/lib/outbound/provider-pause'

/**
 * POST /api/outbound-jobs/resume-provider — melanjutkan pengiriman lewat satu provider.
 *
 * Admin-only. The pause is stored in the database rather than in a module variable, so it holds
 * across every process and survives a redeploy — see provider-pause.ts for why that is the whole
 * point of a control meant to be trusted during an incident.
 *
 * Idempotent: resumeing an already-resumed provider returns the same set and is not an error.
 * An operator hammering the button in an incident should not be told they did something wrong.
 */
const bodySchema = z.object({
  provider: z.enum(PAUSABLE_PROVIDERS),
  reason: z.string().trim().min(10).max(2000),
})

export async function POST(req: Request) {
  const admin = await requireAdmin(req)
  if (!admin) {
    const session = await getSession(req)
    return NextResponse.json(
      { error: session ? 'Hanya admin yang bisa melanjutkan provider' : 'Tidak terautentikasi' },
      { status: session ? 403 : 401 }
    )
  }

  const parsed = await parseJsonBody(req, bodySchema, 'Provider dan alasan wajib diisi, alasan minimal 10 karakter')
  if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 })

  try {
    const before = await getPausedProviders()
    const paused = await resumeProvider(parsed.data.provider)

    await writeBotAuditLog({
      action: 'ENABLE',
      entityType: 'OUTBOUND_PROVIDER',
      entityKey: parsed.data.provider,
      actorId: admin.accountId,
      before: { pausedProviders: before },
      after: { pausedProviders: paused },
      reason: parsed.data.reason,
      req,
    })

    return NextResponse.json({ provider: parsed.data.provider, pausedProviders: paused })
  } catch (error) {
    console.error('POST /api/outbound-jobs/resume-provider gagal', error)
    return NextResponse.json({ error: 'Gagal melanjutkan provider' }, { status: 500 })
  }
}

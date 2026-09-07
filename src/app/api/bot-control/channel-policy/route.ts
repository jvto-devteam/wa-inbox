import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/get-session'
import { getChannelPolicyState, PolicyNotFoundError } from '@/lib/bot-control/channel-policy-workflow'
import { SAFETY_BOUNDS, CHANNEL_CAPABILITY_KEYS, CAPABILITY_TARGETS } from '@/lib/bot-control/channel-policy-config'

/**
 * GET /api/bot-control/channel-policy — the live policy, its pending draft, and its warnings.
 *
 * Readable by any signed-in user: which channel the account sends on, and what the safety
 * thresholds are, is the context every agent needs to read a delivery failure. Nothing here is
 * a credential.
 *
 * The bounds travel with the response so the editor can render its own limits from the server's
 * numbers rather than a second copy that drifts.
 */
export async function GET(req: Request) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 })

  try {
    const state = await getChannelPolicyState()
    return NextResponse.json({
      ...state,
      bounds: SAFETY_BOUNDS,
      capabilityKeys: CHANNEL_CAPABILITY_KEYS,
      capabilityTargets: CAPABILITY_TARGETS,
    })
  } catch (error) {
    if (error instanceof PolicyNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 })
    console.error('GET /api/bot-control/channel-policy gagal', error)
    return NextResponse.json({ error: 'Gagal memuat kebijakan channel' }, { status: 500 })
  }
}

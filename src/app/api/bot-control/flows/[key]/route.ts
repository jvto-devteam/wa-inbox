import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/get-session'
import { getExistingFlow } from '@/lib/bot-control/existing-flow-registry'

/**
 * GET /api/bot-control/flows/[key] — satu flow lengkap dengan nodes dan edges.
 *
 * `params` adalah Promise di Next.js 16 dan wajib di-await; membacanya sebagai objek biasa
 * lolos di editor tetapi gagal saat build.
 */
export async function GET(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 })

  const { key } = await params
  const flow = getExistingFlow(key)
  if (!flow) return NextResponse.json({ error: 'Flow tidak ditemukan' }, { status: 404 })

  return NextResponse.json(flow)
}

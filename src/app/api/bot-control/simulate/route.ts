import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/auth/require-admin'
import { parseJsonBody } from '@/lib/parse-json'
import { runSimulation } from '@/lib/bot-control/simulator'

/**
 * POST /api/bot-control/simulate — run a message through the real decision engine, send nothing.
 *
 * Admin-only (guidebook §19): a simulation spends real Ollama time and writes an audit row, so
 * it is not something an AGENT should be able to trigger in a loop.
 *
 * This route imports `runSimulation` and nothing else from the send path. `sendMessage` is not
 * reachable from here, which is what makes "tidak ada outbound WhatsApp" a structural property
 * rather than a promise.
 */
const bodySchema = z.object({
  message: z.string().min(1),
  conversationId: z.string().optional(),
  contactPhone: z.string().optional(),
  contactName: z.string().optional(),
  useExistingHistory: z.boolean().optional(),
  // Accepted for contract compatibility with guidebook §13. There is no non-dry mode: this
  // endpoint cannot send, so `dryRun: false` is rejected rather than silently treated as true,
  // which would be a lie about what the caller asked for.
  dryRun: z.literal(true).optional(),
})

export async function POST(req: Request) {
  const admin = await requireAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Hanya admin yang bisa menjalankan simulasi' }, { status: 403 })

  const parsed = await parseJsonBody(req, bodySchema, 'Data simulasi tidak valid')
  if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 })

  try {
    return NextResponse.json(await runSimulation(parsed.data))
  } catch (error) {
    console.error('POST /api/bot-control/simulate gagal', error)
    return NextResponse.json({ error: 'Simulasi gagal — cek log server' }, { status: 500 })
  }
}

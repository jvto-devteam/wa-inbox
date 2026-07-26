import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { verifySessionToken } from '@/lib/auth/session'

// Backs the admin-only "Webhook & kredensial" panel on the Settings page.
// Deliberately admin-gated server-side (not just hidden in the UI) and
// deliberately returns only presence booleans for the two secrets — never
// prisma.waNumber.accessToken/coexistApiKey themselves. coexistBaseUrl is not
// a secret (just a service address) so it's returned as-is for reference.
async function requireAdmin(req: Request) {
  const token = req.headers.get('cookie')?.match(/wa_inbox_session=([^;]+)/)?.[1]
  const session = token ? await verifySessionToken(decodeURIComponent(token)) : null
  return session?.role === 'ADMIN' ? session : null
}

export async function GET(req: Request) {
  const admin = await requireAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Hanya admin yang bisa melihat kredensial' }, { status: 403 })

  const waNumber = await prisma.waNumber.findFirstOrThrow()
  return NextResponse.json({
    coexistBaseUrl: waNumber.coexistBaseUrl,
    accessTokenSet: Boolean(waNumber.accessToken),
    coexistApiKeySet: Boolean(waNumber.coexistApiKey),
  })
}

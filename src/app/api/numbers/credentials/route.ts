import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/require-admin'

// Backs the admin-only "Webhook & kredensial" panel on the Settings page.
// Deliberately admin-gated server-side (not just hidden in the UI) and
// deliberately returns only presence booleans for the two secrets — never
// prisma.waNumber.accessToken/coexistApiKey themselves. coexistBaseUrl is not
// a secret (just a service address) so it's returned as-is for reference.
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

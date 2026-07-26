import { NextResponse } from 'next/server'
import { verifySessionToken } from '@/lib/auth/session'

// Lets client components (the Settings page in particular) find out the
// current account's role so admin-only sections can gate themselves. The
// global middleware already blocks unauthenticated requests to /api/* before
// they reach here, but — matching the inline cookie-parsing convention used
// throughout this codebase (see e.g. src/app/api/send/route.ts,
// src/app/api/contacts/[id]/notes/route.ts) — this route re-verifies the
// session itself rather than assuming middleware ran, since route handlers
// are also called directly in tests.
export async function GET(req: Request) {
  const token = req.headers.get('cookie')?.match(/wa_inbox_session=([^;]+)/)?.[1]
  const session = token ? await verifySessionToken(decodeURIComponent(token)) : null
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ role: session.role })
}

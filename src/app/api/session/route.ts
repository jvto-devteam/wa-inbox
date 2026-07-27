import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/get-session'

// Lets client components (the Settings page in particular) find out the
// current account's role so admin-only sections can gate themselves. The
// global middleware already blocks unauthenticated requests to /api/* before
// they reach here — and is also where the live tokenVersion revocation check
// runs — but this route still re-verifies the session itself rather than
// assuming middleware ran, since route handlers are also called directly in
// tests. Cookie parsing is shared via getSession() (src/lib/auth/get-session.ts).
export async function GET(req: Request) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ role: session.role })
}

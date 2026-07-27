import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/get-session'
import { prisma } from '@/lib/db'

// Next.js middleware runs on the Edge runtime by default, which cannot run
// Prisma. The session check below has to reach the database, so this file
// opts into the Node.js runtime. That is stable in Next 16 (this project is
// on 16.2.12) — no `experimental.nodeMiddleware` flag is needed.
//
// Verified against a real `next build`: the emitted
// .next/server/functions-config-manifest.json contains
// `"/_middleware": { "runtime": "nodejs", ... }` and the Edge-only
// .next/server/middleware-manifest.json is empty, confirming the middleware
// is bundled for Node and that importing Prisma here does not break the build.
export const runtime = 'nodejs'

const PUBLIC_PATHS = ['/login', '/api/auth/login', '/api/webhooks/meta']

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) return NextResponse.next()

  const session = await getSession(req)

  // A valid signature alone only proves that *some* session was issued at
  // *some* point in the last 30 days. On its own it survives the account
  // being deleted (offboarding wouldn't actually revoke access), its password
  // being reset (the presumably-compromised session keeps working), and its
  // role being changed (a demoted admin keeps admin rights until expiry).
  //
  // So every request also confirms, live, that the account still exists and
  // that its tokenVersion still matches the one baked into the token. A
  // deleted account has no row at all, which fails the same check as a stale
  // version — both are simply "not a valid session", never an exception.
  //
  // This is one indexed primary-key lookup per request. At this app's scale
  // (a single tour operator's inbox) that is cheaper than the alternative of
  // scattering the check across every route handler and eventually missing one.
  const account = session
    ? await prisma.account.findUnique({
        where: { id: session.accountId },
        select: { tokenVersion: true },
      })
    : null

  if (!session || !account || account.tokenVersion !== session.tokenVersion) {
    if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    return NextResponse.redirect(new URL('/login', req.url))
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}

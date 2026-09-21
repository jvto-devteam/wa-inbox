import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/get-session'
import { prisma } from '@/lib/db'
import { hasValidCronSecret } from '@/lib/outbound/cron-auth'
import { bearerApiKey } from '@/lib/api-clients/auth'

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

const PUBLIC_PATHS = [
  '/login',
  '/api/auth/login',
  '/api/webhooks/meta',
  '/logo.png',
  '/icon.png',
  // Manifest PWA + ikonnya: browser membacanya SEBELUM ada sesi (untuk memutuskan apakah
  // menawarkan "Install app"), termasuk di layar /login itu sendiri -- tanpa baris ini,
  // setiap permintaan ke jalur-jalur ini kena redirect ke /login, jadi manifest-nya sendiri
  // tidak pernah berhasil dibaca browser.
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-icon.png',
]

/**
 * Endpoints a scheduler may call with a shared secret instead of a session cookie.
 *
 * Deliberately NOT added to PUBLIC_PATHS. That list is matched with `startsWith`, so putting
 * this path there would also expose `/api/outbound-jobs/process-anything-else` to the world,
 * and it would make the endpoint public outright rather than secret-gated. This is an exact
 * match, and it still requires a valid secret — a request without one falls straight through
 * to the normal session check below and is rejected like any other.
 */
const CRON_PATHS = new Set(['/api/outbound-jobs/process'])

/**
 * Endpoints other programs (javavolcano-touroperator, new-backoffice) call with an API key.
 *
 * Same exact-match reasoning as CRON_PATHS. Only the SHAPE of the key is checked here (a
 * `Bearer wai_...` header), which is enough to decide "this is not a browser session request";
 * the key itself is verified against ApiClient by the route handler, which is the only place
 * that knows which client it belongs to. A request without such a header falls through to the
 * session check and gets the usual 401.
 */
const API_KEY_PATHS = new Set(['/api/v1/system-messages', '/api/v1/system-messages/templates'])

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) return NextResponse.next()

  // Checked before the session lookup so a cron never needs an account row, and skipped
  // entirely (hasValidCronSecret returns false) when no secret is configured.
  if (CRON_PATHS.has(pathname) && hasValidCronSecret(req)) return NextResponse.next()
  if (API_KEY_PATHS.has(pathname) && bearerApiKey(req)) return NextResponse.next()

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

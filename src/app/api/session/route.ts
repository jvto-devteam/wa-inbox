import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/get-session'
import { prisma } from '@/lib/db'

// Lets client components (the Settings page in particular) find out the
// current account's role so admin-only sections can gate themselves. The
// global middleware already blocks unauthenticated requests to /api/* before
// they reach here — and is also where the live tokenVersion revocation check
// runs — but this route still re-verifies the session itself rather than
// assuming middleware ran, since route handlers are also called directly in
// tests. Cookie parsing is shared via getSession() (src/lib/auth/get-session.ts).
//
// `name` is served alongside `role` for the account avatar in the global nav bar
// (src/components/AppNav.tsx). It is not in the JWT — the token carries only accountId, role
// and tokenVersion — so it costs one indexed primary-key lookup, the same query middleware
// already runs on every request. The alternative was initials derived from the role ("AD" for
// every admin in the company), which is not an identity. Purely additive: the Settings page's
// existing `{ role }` read is unaffected.
//
// A missing row means the account was deleted after the token was minted. That is exactly the
// case middleware's revocation check rejects, so answer it the same way rather than returning
// a session with a blank name.
export async function GET(req: Request) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const account = await prisma.account.findUnique({
    where: { id: session.accountId },
    select: { name: true },
  })
  if (!account) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  return NextResponse.json({ role: session.role, name: account.name })
}

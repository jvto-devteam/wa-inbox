import { NextRequest, NextResponse } from 'next/server'
import { verifySessionToken } from '@/lib/auth/session'

const PUBLIC_PATHS = ['/login', '/api/auth/login', '/api/webhooks/meta']

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) return NextResponse.next()

  const token = req.cookies.get('wa_inbox_session')?.value
  const session = token ? await verifySessionToken(token) : null
  if (!session) {
    if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    return NextResponse.redirect(new URL('/login', req.url))
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}

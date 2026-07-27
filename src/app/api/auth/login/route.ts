import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { verifyPassword } from '@/lib/auth/password'
import { createSessionCookie } from '@/lib/auth/session'

const bodySchema = z.object({ email: z.string().email(), password: z.string().min(1) })

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'Email atau kata sandi tidak valid' }, { status: 400 })

  const account = await prisma.account.findUnique({ where: { email: parsed.data.email } })
  if (!account || !(await verifyPassword(parsed.data.password, account.passwordHash))) {
    return NextResponse.json({ error: 'Email atau kata sandi salah' }, { status: 401 })
  }

  // tokenVersion is baked into the token so src/middleware.ts can revoke it
  // the moment the account's version is bumped (password reset, role change).
  const token = await createSessionCookie({
    accountId: account.id,
    role: account.role,
    tokenVersion: account.tokenVersion,
  })
  const res = NextResponse.json({ ok: true })
  res.cookies.set('wa_inbox_session', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 30,
    path: '/',
  })
  return res
}

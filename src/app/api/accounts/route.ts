import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { verifySessionToken } from '@/lib/auth/session'
import { hashPassword } from '@/lib/auth/password'

// Widened from Task 42's { id, name } (originally selected tightly for
// ThreadView's agent-assignment dropdown, which only needs id/name) to also
// include email/role: the new admin-only "Manajemen pengguna" panel on the
// Settings page (Task 47) needs to show who is ADMIN vs AGENT and their
// email. passwordHash is still deliberately excluded — it must never leave
// the server. Extra fields don't break ThreadView's existing narrow usage.
export async function GET() {
  const accounts = await prisma.account.findMany({ select: { id: true, name: true, email: true, role: true } })
  return NextResponse.json(accounts)
}

async function requireAdmin(req: Request) {
  const token = req.headers.get('cookie')?.match(/wa_inbox_session=([^;]+)/)?.[1]
  const session = token ? await verifySessionToken(decodeURIComponent(token)) : null
  return session?.role === 'ADMIN' ? session : null
}

const createSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(8),
  role: z.enum(['ADMIN', 'AGENT']),
})

export async function POST(req: Request) {
  const admin = await requireAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Hanya admin yang bisa menambah akun' }, { status: 403 })

  const parsed = createSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'Data akun tidak valid' }, { status: 400 })

  const passwordHash = await hashPassword(parsed.data.password)
  const account = await prisma.account.create({
    data: { email: parsed.data.email, name: parsed.data.name, role: parsed.data.role, passwordHash },
  })
  return NextResponse.json({ id: account.id, email: account.email, name: account.name, role: account.role })
}

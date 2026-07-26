import { NextResponse } from 'next/server'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { verifySessionToken } from '@/lib/auth/session'
import { hashPassword } from '@/lib/auth/password'

async function requireAdmin(req: Request) {
  const token = req.headers.get('cookie')?.match(/wa_inbox_session=([^;]+)/)?.[1]
  const session = token ? await verifySessionToken(decodeURIComponent(token)) : null
  return session?.role === 'ADMIN' ? session : null
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Hanya admin yang bisa menghapus akun' }, { status: 403 })

  const { id } = await params
  try {
    await prisma.account.delete({ where: { id } })
  } catch (err) {
    // Account.notes (Note.authorId) is a required relation and
    // Conversation.assignedAgentId has no onDelete: SetNull, so deleting an
    // account that still has authored notes or assigned conversations fails
    // the FK constraint (P2003). Surface that as a clean 409 rather than an
    // unhandled 500 — this task doesn't build reassignment/cascade logic,
    // just a legible error instead of a crash.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
      return NextResponse.json(
        { error: 'Akun tidak dapat dihapus karena masih memiliki percakapan atau catatan terkait' },
        { status: 409 }
      )
    }
    throw err
  }
  return NextResponse.json({ ok: true })
}

const patchSchema = z.object({ password: z.string().min(8) })

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Hanya admin yang bisa reset kata sandi' }, { status: 403 })

  const { id } = await params
  const parsed = patchSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'Kata sandi minimal 8 karakter' }, { status: 400 })

  const passwordHash = await hashPassword(parsed.data.password)
  await prisma.account.update({ where: { id }, data: { passwordHash } })
  return NextResponse.json({ ok: true })
}

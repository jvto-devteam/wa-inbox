import { NextResponse } from 'next/server'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { hashPassword } from '@/lib/auth/password'
import { requireAdmin } from '@/lib/auth/require-admin'
import { parseJsonBody } from '@/lib/parse-json'

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Hanya admin yang bisa menghapus akun' }, { status: 403 })

  const { id } = await params

  // Deleting yourself logs you out of an account you can no longer restore,
  // and is almost always a misclick on the wrong row.
  if (id === admin.accountId) {
    return NextResponse.json({ error: 'Anda tidak bisa menghapus akun Anda sendiri' }, { status: 400 })
  }

  // Deleting the last ADMIN permanently locks out user management, the
  // webhook credentials panel and settings editing — there is no in-app way
  // back, only direct database access. Refuse rather than let it happen.
  const target = await prisma.account.findUnique({ where: { id }, select: { role: true } })
  if (!target) return NextResponse.json({ error: 'Akun tidak ditemukan' }, { status: 404 })
  if (target.role === 'ADMIN') {
    const adminCount = await prisma.account.count({ where: { role: 'ADMIN' } })
    if (adminCount <= 1) {
      return NextResponse.json(
        { error: 'Tidak bisa menghapus admin terakhir — sisakan minimal satu admin' },
        { status: 400 }
      )
    }
  }

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
  const parsed = await parseJsonBody(req, patchSchema, 'Kata sandi minimal 8 karakter')
  if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const passwordHash = await hashPassword(parsed.data.password)
  // A password reset is the response to a compromised (or offboarded)
  // account, so it has to kill the sessions that were already issued — the
  // JWT itself is otherwise valid for 30 more days regardless of the new
  // password. Bumping tokenVersion makes src/middleware.ts reject every
  // outstanding token for this account on the very next request.
  await prisma.account.update({
    where: { id },
    data: { passwordHash, tokenVersion: { increment: 1 } },
  })
  return NextResponse.json({ ok: true })
}

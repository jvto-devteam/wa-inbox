import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/require-admin'

/**
 * GET /api/mail-accounts — kotak surat yang tersambung, untuk panel Pengaturan.
 *
 * refreshToken TIDAK PERNAH keluar dari sini (CLAUDE.md §5). Dijaga dua lapis: `select` tanpa
 * kolom itu, DAN pemetaan eksplisit di bawah -- kalau suatu hari `select` dihapus orang,
 * token tetap tidak ikut terserialisasi.
 */
export async function GET(req: Request) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: 'Hanya admin yang bisa melihat kotak surat' }, { status: 403 })
  }
  try {
    const accounts = await prisma.mailAccount.findMany({
      select: { id: true, emailAddress: true, watchExpiresAt: true, lastSyncAt: true, lastSyncError: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    })
    return NextResponse.json({
      pushConfigured: Boolean(process.env.GMAIL_PUBSUB_TOPIC),
      items: accounts.map((a) => ({
        id: a.id,
        emailAddress: a.emailAddress,
        watchExpiresAt: a.watchExpiresAt?.toISOString() ?? null,
        lastSyncAt: a.lastSyncAt?.toISOString() ?? null,
        lastSyncError: a.lastSyncError,
        createdAt: a.createdAt.toISOString(),
      })),
    })
  } catch {
    return NextResponse.json({ error: 'Gagal memuat kotak surat' }, { status: 500 })
  }
}

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { relinkCoexist } from '@/lib/coexist/client'
import { requireAdmin } from '@/lib/auth/require-admin'

// Re-pairing the unofficial (coexist) number is an infrastructure operation:
// it can drop the live WhatsApp session for the whole company mid-conversation.
// Admin-only, enforced here rather than only in the Settings page's UI.
export async function POST(req: Request) {
  const admin = await requireAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Hanya admin yang bisa menyambungkan ulang nomor' }, { status: 403 })

  const waNumber = await prisma.waNumber.findFirstOrThrow()
  await relinkCoexist(waNumber)
  return NextResponse.json({ ok: true })
}

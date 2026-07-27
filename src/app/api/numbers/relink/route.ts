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

  // relinkCoexist throws on any wa-coexist failure — unreachable host, non-2xx
  // response, or (since the client gained a timeout) an aborted request. Left
  // unhandled that surfaces as a bare 500 with no body, which the Settings page
  // cannot tell apart from a crash on our side. 502 + Indonesian copy so the
  // admin sees "wa-coexist did not cooperate", not "the inbox is broken".
  try {
    await relinkCoexist(waNumber)
  } catch {
    return NextResponse.json({ error: 'Gagal menyambungkan ulang — periksa wa-coexist' }, { status: 502 })
  }

  return NextResponse.json({ ok: true })
}

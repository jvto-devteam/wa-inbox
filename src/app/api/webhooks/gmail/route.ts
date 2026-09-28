import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { hasValidPushToken } from '@/lib/gmail/push-auth'
import { requestSync } from '@/lib/gmail/sync'

/**
 * POST /api/webhooks/gmail — bel pintu Google Pub/Sub untuk Gmail users.watch().
 *
 * Payload-nya hanya { emailAddress, historyId }: BUKAN isi email. historyId dari push sengaja
 * diabaikan -- kursor kita sendiri (MailAccount.historyId) yang dipakai, supaya push yang
 * datang tidak berurutan tidak pernah membuat email terlewat.
 *
 * Sinkronisasi dijalankan di latar dan jawabannya langsung 204. Pub/Sub menganggap 2xx sebagai
 * ack; payload rusak dan kotak surat tak dikenal juga di-ack, karena mengulangnya tidak akan
 * pernah berhasil. Celah apa pun ditutup cron 15 menit.
 */
export async function POST(req: Request) {
  if (!hasValidPushToken(new URL(req.url))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let emailAddress: string | null = null
  try {
    const body = (await req.json()) as { message?: { data?: string } }
    const decoded = JSON.parse(Buffer.from(body.message?.data ?? '', 'base64').toString('utf8')) as { emailAddress?: unknown }
    emailAddress = typeof decoded.emailAddress === 'string' ? decoded.emailAddress.toLowerCase() : null
  } catch {
    return new NextResponse(null, { status: 204 })
  }
  if (!emailAddress) return new NextResponse(null, { status: 204 })

  try {
    const account = await prisma.mailAccount.findUnique({ where: { emailAddress }, select: { id: true } })
    if (account) {
      void requestSync(account.id).catch((error: unknown) => {
        console.error('webhook gmail: sinkronisasi gagal', { accountId: account.id, error: error instanceof Error ? error.name : 'unknown' })
      })
    }
    return new NextResponse(null, { status: 204 })
  } catch {
    return NextResponse.json({ error: 'Gagal memproses notifikasi' }, { status: 500 })
  }
}

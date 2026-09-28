import { timingSafeEqual } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/require-admin'
import { exchangeAuthCode, GMAIL_SCOPES, MAIL_OAUTH_STATE_COOKIE } from '@/lib/gmail/oauth'
import { gmailGetProfile, invalidateAccessToken } from '@/lib/gmail/client'
import { GmailError } from '@/lib/gmail/errors'
import { requestSync } from '@/lib/gmail/sync'

type Outcome = 'tersambung' | 'dibatalkan' | 'state-tidak-cocok' | 'tanpa-refresh-token' | 'izin-kurang' | 'gagal'

function sameState(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8')
  const y = Buffer.from(b, 'utf8')
  return x.length === y.length && timingSafeEqual(x, y)
}

/**
 * GET /api/mail-accounts/oauth/callback — Google mengarahkan kembali ke sini setelah layar izin.
 *
 * Selalu berakhir dengan redirect ke panel Pengaturan membawa `?mail=<hasil>`, tidak pernah
 * JSON: yang membuka URL ini adalah browser admin, bukan program.
 */
export async function GET(req: NextRequest) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: 'Hanya admin yang bisa menyambungkan kotak surat' }, { status: 403 })
  }

  const finish = (outcome: Outcome) => {
    const res = NextResponse.redirect(new URL(`/settings?section=kotak-surat&mail=${outcome}`, req.url))
    res.cookies.set(MAIL_OAUTH_STATE_COOKIE, '', { path: '/api/mail-accounts/oauth', maxAge: 0 })
    return res
  }

  const params = req.nextUrl.searchParams
  const expected = req.cookies.get(MAIL_OAUTH_STATE_COOKIE)?.value
  const state = params.get('state')
  if (!expected || !state || !sameState(state, expected)) return finish('state-tidak-cocok')
  if (params.get('error')) return finish('dibatalkan')
  const code = params.get('code')
  if (!code) return finish('gagal')

  try {
    const tokens = await exchangeAuthCode(code)
    // Layar izin Google membolehkan pengguna tidak mencentang sebagian scope. Kotak surat
    // tanpa izin kirim akan tampak tersambung lalu gagal di balasan PERTAMA -- tolak di sini.
    if (!GMAIL_SCOPES.every((scope) => tokens.grantedScopes.includes(scope))) return finish('izin-kurang')
    if (!tokens.refreshToken) return finish('tanpa-refresh-token')

    const profile = await gmailGetProfile(tokens.accessToken)
    const emailAddress = profile.emailAddress.toLowerCase()
    const account = await prisma.mailAccount.upsert({
      where: { emailAddress },
      // Menyambung ulang mempertahankan kursor lama: email yang masuk selama token mati
      // tertarik di sinkronisasi berikutnya (atau lewat pemulihan 7 hari kalau kursornya
      // sudah terlalu tua).
      update: { refreshToken: tokens.refreshToken, lastSyncError: null },
      create: { emailAddress, refreshToken: tokens.refreshToken, historyId: profile.historyId },
      select: { id: true },
    })
    invalidateAccessToken(account.id)
    // Sinkronisasi pertama langsung: ia yang memasang watch(), jadi push hidup tanpa menunggu cron.
    // Kegagalannya tidak menggagalkan koneksi kotak surat (cron 15 menit menutup celahnya), tapi
    // ditelan diam-diam tanpa log berarti tidak ada cara melacak KENAPA push belum hidup -- catat
    // seperti webhook (src/app/api/webhooks/gmail/route.ts), bukan pesan mentah/secret.
    void requestSync(account.id).catch((error: unknown) => {
      console.error('oauth callback: sinkronisasi pertama gagal', { accountId: account.id, error: error instanceof Error ? error.name : 'unknown' })
    })
    return finish('tersambung')
  } catch (error) {
    console.error('oauth callback kotak surat gagal', { kind: error instanceof GmailError ? error.kind : 'unknown' })
    return finish('gagal')
  }
}

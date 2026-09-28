import { randomBytes } from 'node:crypto'
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/require-admin'
import { buildGoogleAuthUrl, MAIL_OAUTH_STATE_COOKIE } from '@/lib/gmail/oauth'

/**
 * GET /api/mail-accounts/oauth/start — arahkan admin ke layar izin Google.
 *
 * `state` acak disimpan di cookie httpOnly berumur 10 menit dan dicocokkan di callback --
 * tanpa itu, siapa pun bisa membuat admin yang sedang login tanpa sadar menyambungkan kotak
 * surat MILIK PENYERANG ke Inbox JVTO (CSRF login). sameSite 'lax' wajib: cookie harus ikut
 * saat Google mengarahkan balik lewat navigasi tingkat atas.
 */
export async function GET(req: Request) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: 'Hanya admin yang bisa menyambungkan kotak surat' }, { status: 403 })
  }
  try {
    const state = randomBytes(24).toString('base64url')
    const res = NextResponse.redirect(buildGoogleAuthUrl(state))
    res.cookies.set(MAIL_OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/mail-accounts/oauth',
      maxAge: 600,
    })
    return res
  } catch {
    return NextResponse.json({ error: 'Google OAuth belum dikonfigurasi di server' }, { status: 500 })
  }
}

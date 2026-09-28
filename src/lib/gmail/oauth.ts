import { GmailError } from './errors'

/**
 * OAuth Google untuk kotak surat JVTO.
 *
 * readonly + send, tidak lebih. `gmail.modify` tidak diminta: wa-inbox tidak pernah menandai
 * dibaca, memindah, atau menghapus apa pun di Gmail -- Gmail tetap milik manusia yang
 * membukanya, wa-inbox hanya membaca dan membalas.
 */
export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
] as const

/** Cookie penyimpan `state` antara /oauth/start dan /oauth/callback. */
export const MAIL_OAUTH_STATE_COOKIE = 'mail_oauth_state'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'

interface TokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  error?: string
}

function oauthConfig(): { clientId: string; clientSecret: string; redirectUri: string } {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET
  const base = process.env.APP_BASE_URL
  if (!clientId || !clientSecret || !base) {
    throw new GmailError('CONFIG', 'Google OAuth belum dikonfigurasi (GOOGLE_OAUTH_CLIENT_ID/SECRET, APP_BASE_URL)')
  }
  return { clientId, clientSecret, redirectUri: `${base.replace(/\/+$/, '')}/api/mail-accounts/oauth/callback` }
}

export function buildGoogleAuthUrl(state: string): string {
  const { clientId, redirectUri } = oauthConfig()
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GMAIL_SCOPES.join(' '),
    access_type: 'offline',
    // Tanpa ini, menyambung ulang kotak surat yang pernah disambungkan TIDAK mengembalikan
    // refresh_token -- token yang dicabut jadi tidak pernah bisa diganti dari UI.
    prompt: 'consent',
    state,
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

async function postToken(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  })
  const json = (await res.json().catch(() => ({}))) as TokenResponse
  if (!res.ok) {
    if (json.error === 'invalid_grant') {
      throw new GmailError('AUTH_REVOKED', 'Google menolak refresh token (invalid_grant)', res.status)
    }
    throw new GmailError('HTTP', `Endpoint token Google ${res.status} ${json.error ?? ''}`.trim(), res.status)
  }
  return json
}

export async function exchangeAuthCode(code: string): Promise<{ accessToken: string; refreshToken: string | null; grantedScopes: string[] }> {
  const { clientId, clientSecret, redirectUri } = oauthConfig()
  const json = await postToken({
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
  })
  if (!json.access_token) throw new GmailError('HTTP', 'Endpoint token Google tidak mengembalikan access_token')
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    grantedScopes: (json.scope ?? '').split(' ').filter(Boolean),
  }
}

export async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresInSec: number }> {
  const { clientId, clientSecret } = oauthConfig()
  const json = await postToken({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  })
  if (!json.access_token) throw new GmailError('HTTP', 'Endpoint token Google tidak mengembalikan access_token')
  return { accessToken: json.access_token, expiresInSec: json.expires_in ?? 3600 }
}

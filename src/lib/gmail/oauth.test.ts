import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { buildGoogleAuthUrl, exchangeAuthCode, refreshAccessToken, GMAIL_SCOPES } from './oauth'
import { GmailError } from './errors'

beforeEach(() => {
  vi.stubEnv('GOOGLE_OAUTH_CLIENT_ID', 'client-id-uji')
  vi.stubEnv('GOOGLE_OAUTH_CLIENT_SECRET', 'client-secret-uji')
  vi.stubEnv('APP_BASE_URL', 'https://inbox.contoh.test/')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('buildGoogleAuthUrl', () => {
  it('meminta akses offline dengan prompt=consent dan kedua scope Gmail', () => {
    const url = new URL(buildGoogleAuthUrl('state-123'))
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(url.searchParams.get('access_type')).toBe('offline')
    // Tanpa prompt=consent, menyambung ulang kotak surat yang sama TIDAK mengembalikan
    // refresh_token -- dan token yang dicabut tidak akan pernah bisa diganti.
    expect(url.searchParams.get('prompt')).toBe('consent')
    expect(url.searchParams.get('scope')).toBe(GMAIL_SCOPES.join(' '))
    expect(url.searchParams.get('state')).toBe('state-123')
    // Garis miring di ujung APP_BASE_URL tidak boleh menghasilkan "//api".
    expect(url.searchParams.get('redirect_uri')).toBe('https://inbox.contoh.test/api/mail-accounts/oauth/callback')
  })

  it('melempar CONFIG kalau client id belum diisi', () => {
    vi.stubEnv('GOOGLE_OAUTH_CLIENT_ID', '')
    expect(() => buildGoogleAuthUrl('s')).toThrow(GmailError)
  })
})

describe('exchangeAuthCode', () => {
  it('mengembalikan refresh token dan scope yang benar-benar diberikan', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'at', refresh_token: 'rt', expires_in: 3599, scope: GMAIL_SCOPES.join(' ') }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await exchangeAuthCode('kode-1')

    expect(result).toEqual({ accessToken: 'at', refreshToken: 'rt', grantedScopes: [...GMAIL_SCOPES] })
    const body = String(fetchMock.mock.calls[0][1].body)
    expect(body).toContain('grant_type=authorization_code')
    expect(body).toContain('code=kode-1')
  })

  it('refreshToken null kalau Google tidak mengirimnya', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ access_token: 'at', expires_in: 3599, scope: '' }),
    }))
    expect((await exchangeAuthCode('k')).refreshToken).toBeNull()
  })
})

describe('refreshAccessToken', () => {
  it('invalid_grant menjadi AUTH_REVOKED', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 400, json: async () => ({ error: 'invalid_grant' }),
    }))
    await expect(refreshAccessToken('rt-mati')).rejects.toMatchObject({ kind: 'AUTH_REVOKED' })
  })

  it('pesan error tidak memuat refresh token', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 500, json: async () => ({ error: 'server_error' }),
    }))
    const error = await refreshAccessToken('rt-rahasia-sekali').catch((e: unknown) => e)
    expect(String((error as Error).message)).not.toContain('rt-rahasia-sekali')
  })
})

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/require-admin'
import { exchangeAuthCode, GMAIL_SCOPES } from '@/lib/gmail/oauth'
import { gmailGetProfile } from '@/lib/gmail/client'
import { requestSync } from '@/lib/gmail/sync'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: vi.fn() }))
vi.mock('@/lib/gmail/oauth', async (orig) => ({ ...(await orig<typeof import('@/lib/gmail/oauth')>()), exchangeAuthCode: vi.fn() }))
vi.mock('@/lib/gmail/client', () => ({ gmailGetProfile: vi.fn(), invalidateAccessToken: vi.fn() }))
vi.mock('@/lib/gmail/sync', () => ({ requestSync: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>
import { GET } from './route'

function callback(query: string, stateCookie: string | null = 'state-ok') {
  const req = new NextRequest(`https://h/api/mail-accounts/oauth/callback?${query}`)
  if (stateCookie) req.cookies.set('mail_oauth_state', stateCookie)
  return GET(req)
}
const outcome = (res: Response) => new URL(res.headers.get('location') ?? '').searchParams.get('mail')

beforeEach(() => {
  mockReset(mockPrisma)
  vi.mocked(requireAdmin).mockReset().mockResolvedValue({ accountId: 'a', role: 'ADMIN' } as never)
  vi.mocked(exchangeAuthCode).mockReset().mockResolvedValue({ accessToken: 'at', refreshToken: 'rt', grantedScopes: [...GMAIL_SCOPES] })
  vi.mocked(gmailGetProfile).mockReset().mockResolvedValue({ emailAddress: 'Hello@X.com', historyId: '77' })
  vi.mocked(requestSync).mockReset().mockResolvedValue({} as never)
  mockPrisma.mailAccount.upsert.mockResolvedValue({ id: 'mail_1' } as never)
})

describe('GET /api/mail-accounts/oauth/callback', () => {
  it('state tidak cocok: ditolak, tidak menukar code', async () => {
    const res = await callback('code=c&state=state-lain')
    expect(outcome(res)).toBe('state-tidak-cocok')
    expect(exchangeAuthCode).not.toHaveBeenCalled()
  })

  it('tanpa cookie state: ditolak', async () => {
    expect(outcome(await callback('code=c&state=state-ok', null))).toBe('state-tidak-cocok')
  })

  it('pengguna membatalkan di layar Google', async () => {
    expect(outcome(await callback('error=access_denied&state=state-ok'))).toBe('dibatalkan')
  })

  it('izin kirim tidak dicentang di layar izin: ditolak, tidak disimpan', async () => {
    vi.mocked(exchangeAuthCode).mockResolvedValue({ accessToken: 'at', refreshToken: 'rt', grantedScopes: [GMAIL_SCOPES[0]] })
    expect(outcome(await callback('code=c&state=state-ok'))).toBe('izin-kurang')
    expect(mockPrisma.mailAccount.upsert).not.toHaveBeenCalled()
  })

  it('tanpa refresh token: ditolak, tidak disimpan', async () => {
    vi.mocked(exchangeAuthCode).mockResolvedValue({ accessToken: 'at', refreshToken: null, grantedScopes: [...GMAIL_SCOPES] })
    expect(outcome(await callback('code=c&state=state-ok'))).toBe('tanpa-refresh-token')
    expect(mockPrisma.mailAccount.upsert).not.toHaveBeenCalled()
  })

  it('sukses: alamat huruf kecil, kursor dari profil, sinkronisasi pertama dipicu, cookie state dihapus', async () => {
    const res = await callback('code=c&state=state-ok')
    expect(outcome(res)).toBe('tersambung')
    expect(mockPrisma.mailAccount.upsert).toHaveBeenCalledWith({
      where: { emailAddress: 'hello@x.com' },
      update: { refreshToken: 'rt', lastSyncError: null },
      create: { emailAddress: 'hello@x.com', refreshToken: 'rt', historyId: '77' },
      select: { id: true },
    })
    expect(requestSync).toHaveBeenCalledWith('mail_1')
    expect(res.headers.get('set-cookie')).toMatch(/mail_oauth_state=;/)
  })

  // Temuan review 6: kegagalan sinkronisasi pertama sebelumnya ditelan diam-diam
  // (`.catch(() => {})`) -- tidak ada cara melacak kenapa push belum hidup untuk kotak surat
  // yang baru disambungkan. Dicatat seperti webhook (src/app/api/webhooks/gmail/route.ts).
  it('sinkronisasi pertama gagal: tetap dianggap tersambung, tapi kegagalannya dicatat', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(requestSync).mockReset().mockRejectedValue(new Error('boom'))

    const res = await callback('code=c&state=state-ok')

    expect(outcome(res)).toBe('tersambung')
    await vi.waitFor(() => expect(consoleError).toHaveBeenCalledWith(
      'oauth callback: sinkronisasi pertama gagal',
      expect.objectContaining({ accountId: 'mail_1', error: 'Error' }),
    ))
    consoleError.mockRestore()
  })
})

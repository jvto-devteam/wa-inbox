import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { refreshAccessToken } from './oauth'
import {
  getAccessToken, invalidateAccessToken, __resetTokenCacheForTests,
  gmailListHistory, gmailGetMessage, gmailGetMessageHeaders, gmailWatch, gmailSendRaw,
} from './client'

vi.mock('./oauth', () => ({ refreshAccessToken: vi.fn() }))

beforeEach(() => {
  __resetTokenCacheForTests()
  vi.mocked(refreshAccessToken).mockReset().mockResolvedValue({ accessToken: 'at-1', expiresInSec: 3600 })
})
afterEach(() => vi.unstubAllGlobals())

const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json })

describe('getAccessToken', () => {
  const account = { id: 'mail_1', refreshToken: 'rt' }

  it('menyimpan token di cache sampai 60 detik sebelum kedaluwarsa', async () => {
    expect(await getAccessToken(account, 0)).toBe('at-1')
    expect(await getAccessToken(account, 3_000_000)).toBe('at-1')
    expect(refreshAccessToken).toHaveBeenCalledTimes(1)
    await getAccessToken(account, 3_550_000)
    expect(refreshAccessToken).toHaveBeenCalledTimes(2)
  })

  it('invalidateAccessToken memaksa refresh berikutnya', async () => {
    await getAccessToken(account, 0)
    invalidateAccessToken('mail_1')
    await getAccessToken(account, 1)
    expect(refreshAccessToken).toHaveBeenCalledTimes(2)
  })
})

describe('panggilan Gmail', () => {
  it('history 404 menjadi HISTORY_EXPIRED', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: { status: 'NOT_FOUND' } }) }))
    await expect(gmailListHistory('at', '100')).rejects.toMatchObject({ kind: 'HISTORY_EXPIRED' })
  })

  it('history meminta hanya messageAdded dan meneruskan pageToken', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({ historyId: '200' }))
    vi.stubGlobal('fetch', fetchMock)
    await gmailListHistory('at', '100', 'p2')
    const url = new URL(String(fetchMock.mock.calls[0][0]))
    expect(url.pathname).toBe('/gmail/v1/users/me/history')
    expect(url.searchParams.get('startHistoryId')).toBe('100')
    expect(url.searchParams.get('historyTypes')).toBe('messageAdded')
    expect(url.searchParams.get('pageToken')).toBe('p2')
  })

  it('message 404 menjadi null, bukan lemparan (email sudah dihapus sebelum sempat dibaca)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) }))
    expect(await gmailGetMessage('at', 'm1')).toBeNull()
  })

  it('401 menjadi UNAUTHORIZED', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }))
    await expect(gmailGetMessage('at', 'm1')).rejects.toMatchObject({ kind: 'UNAUTHORIZED' })
  })

  it('header balasan dikembalikan dengan kunci huruf kecil', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok({
      payload: { headers: [{ name: 'Message-Id', value: '<a@b>' }, { name: 'Subject', value: 'Bromo' }] },
    })))
    expect(await gmailGetMessageHeaders('at', 'm1', ['Message-ID', 'Subject'])).toEqual({ 'message-id': '<a@b>', subject: 'Bromo' })
  })

  it('watch mengirim topik dan filter label INBOX+SENT', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({ historyId: '5', expiration: '1760000000000' }))
    vi.stubGlobal('fetch', fetchMock)
    await gmailWatch('at', 'projects/p/topics/t')
    // Nilai enum diverifikasi terhadap HTML mentah dokumentasi users.watch: LabelFilterAction
    // pakai huruf kecil ("include"/"exclude"), bukan "INCLUDE" seperti draf awal brief.
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({
      topicName: 'projects/p/topics/t', labelIds: ['INBOX', 'SENT'], labelFilterBehavior: 'include',
    })
  })

  it('send mengirim raw dan threadId', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({ id: 'gm_1', threadId: 'th_1' }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await gmailSendRaw('at', 'UkFX', 'th_1')).toEqual({ id: 'gm_1', threadId: 'th_1' })
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({ raw: 'UkFX', threadId: 'th_1' })
  })
})

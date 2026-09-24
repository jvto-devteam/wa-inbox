import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { sendMessengerText } from './messenger-send'

beforeEach(() => {
  vi.stubEnv('FB_PAGE_ACCESS_TOKEN', 'token-uji')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('sendMessengerText', () => {
  it('mengirim ke Graph API dan mengembalikan message id', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ message_id: 'm_out_1' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const res = await sendMessengerText('psid_abc', 'Halo!')

    expect(res).toEqual({ externalId: 'm_out_1' })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.recipient).toEqual({ id: 'psid_abc' })
    expect(body.message).toEqual({ text: 'Halo!' })
  })

  // Token tidak boleh pernah ikut ke pesan error yang bisa mendarat di UI atau audit log.
  it('tidak membocorkan token di pesan error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 400,
      json: async () => ({ error: { message: 'Invalid OAuth token token-uji', code: 190 } }),
    }))

    await expect(sendMessengerText('psid_abc', 'Halo!')).rejects.toThrow()
    await expect(sendMessengerText('psid_abc', 'Halo!')).rejects.not.toThrow(/token-uji/)
  })

  // Messenger menolak balasan di luar jendela 24 jam dengan error code 10. Tanpa pesan
  // yang bisa dibaca manusia, agen hanya melihat "gagal kirim" dan mencoba lagi berkali-kali
  // pada sesuatu yang tidak akan pernah berhasil.
  it('memberi pesan jelas saat di luar jendela 24 jam', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 400,
      json: async () => ({ error: { message: 'outside of the allowed window', code: 10 } }),
    }))

    await expect(sendMessengerText('psid_abc', 'Halo!')).rejects.toThrow(/24 jam/)
  })
})

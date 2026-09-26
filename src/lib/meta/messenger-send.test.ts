import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { sendMessengerText } from './messenger-send'

beforeEach(() => {
  vi.stubEnv('FB_PAGE_ACCESS_TOKEN', 'token-uji')
  vi.stubEnv('IG_USER_TOKEN', 'token-ig-uji')
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

    const res = await sendMessengerText('psid_abc', 'Halo!', 'FACEBOOK')

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

    await expect(sendMessengerText('psid_abc', 'Halo!', 'FACEBOOK')).rejects.toThrow()
    await expect(sendMessengerText('psid_abc', 'Halo!', 'FACEBOOK')).rejects.not.toThrow(/token-uji/)
  })

  // Messenger menolak balasan di luar jendela 24 jam dengan error code 10. Tanpa pesan
  // yang bisa dibaca manusia, agen hanya melihat "gagal kirim" dan mencoba lagi berkali-kali
  // pada sesuatu yang tidak akan pernah berhasil.
  it('memberi pesan jelas saat di luar jendela 24 jam', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 400,
      json: async () => ({ error: { message: 'outside of the allowed window', code: 10 } }),
    }))

    await expect(sendMessengerText('psid_abc', 'Halo!', 'FACEBOOK')).rejects.toThrow(/24 jam/)
  })
})

describe('cabang Instagram', () => {
  it('mengirim ke IGSID tanpa messaging_type', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ message_id: 'm_ig_1' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const res = await sendMessengerText('igsid_777', 'Halo!', 'INSTAGRAM')

    expect(res).toEqual({ externalId: 'm_ig_1' })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.recipient).toEqual({ id: 'igsid_777' })
    expect(body.message).toEqual({ text: 'Halo!' })
    // Dokumentasi Instagram tidak menyertakan messaging_type. Mengirim field yang tidak
    // dikenal ke Graph API berisiko ditolak, dan tidak ada alasan mengirimnya.
    expect(body).not.toHaveProperty('messaging_type')
  })

  it('menyebut Instagram, bukan Facebook, saat jendela 24 jam lewat', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 400, json: async () => ({ error: { code: 10 } }),
    }))

    await expect(sendMessengerText('igsid_777', 'Halo!', 'INSTAGRAM'))
      .rejects.toThrow(/Instagram menolak.*24 jam/)
  })

  it('tidak membocorkan token di pesan error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 400,
      json: async () => ({ error: { message: 'Invalid OAuth token token-uji', code: 190 } }),
    }))

    await expect(sendMessengerText('igsid_777', 'Halo!', 'INSTAGRAM')).rejects.not.toThrow(/token-uji/)
  })
})

// Regresi: Facebook tetap mengirim messaging_type RESPONSE dan tetap menyebut Facebook.
it('Facebook tetap mengirim messaging_type RESPONSE', async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ message_id: 'm_fb_1' }) })
  vi.stubGlobal('fetch', fetchMock)

  await sendMessengerText('psid_abc', 'Halo!', 'FACEBOOK')

  const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
  expect(body.messaging_type).toBe('RESPONSE')
})

it('Facebook tetap menyebut Facebook saat jendela lewat', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: false, status: 400, json: async () => ({ error: { code: 10 } }),
  }))

  await expect(sendMessengerText('psid_abc', 'Halo!', 'FACEBOOK'))
    .rejects.toThrow(/Facebook menolak.*24 jam/)
})

// Instagram DM tiba lewat jalur "Instagram API with Instagram login" -- sistem yang BERBEDA
// dari Messenger, dengan host dan token sendiri. IGSID yang kita terima tidak dikenal di
// graph.facebook.com, jadi mengirim ke host yang salah gagal tanpa pesan yang menjelaskan
// apa pun. Terukur di produksi 2026-09-26: pencarian nama ke host yang salah mengembalikan
// 403, dan kontak lahir tanpa nama.
describe('pemilihan host dan token per platform', () => {
  it('Instagram memakai graph.instagram.com, bukan graph.facebook.com', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ message_id: 'm1' }) })
    vi.stubGlobal('fetch', fetchMock)

    await sendMessengerText('igsid_1', 'Halo!', 'INSTAGRAM')

    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('graph.instagram.com')
    expect(url).not.toContain('graph.facebook.com')
  })

  it('Facebook tetap memakai graph.facebook.com', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ message_id: 'm2' }) })
    vi.stubGlobal('fetch', fetchMock)

    await sendMessengerText('psid_1', 'Halo!', 'FACEBOOK')

    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('graph.facebook.com')
    expect(url).not.toContain('graph.instagram.com')
  })

  // Token yang tertukar adalah kegagalan yang paling sulit dilihat: URL-nya benar, host-nya
  // benar, dan Meta hanya membalas 403 tanpa menyebut token mana yang dipakai.
  it('tiap platform memakai token env-nya sendiri', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ message_id: 'm3' }) })
    vi.stubGlobal('fetch', fetchMock)

    await sendMessengerText('igsid_1', 'Halo!', 'INSTAGRAM')
    await sendMessengerText('psid_1', 'Halo!', 'FACEBOOK')

    expect(String(fetchMock.mock.calls[0][0])).toContain('token-ig-uji')
    expect(String(fetchMock.mock.calls[1][0])).toContain('token-uji')
  })

  it('menyebut env var yang benar saat tokennya belum diatur', async () => {
    vi.stubEnv('IG_USER_TOKEN', '')
    await expect(sendMessengerText('igsid_1', 'Halo!', 'INSTAGRAM')).rejects.toThrow(/IG_USER_TOKEN/)
  })
})

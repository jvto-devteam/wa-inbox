import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { fetchMessengerProfileName, fetchMessengerProfileLink } from './messenger-profile'

beforeEach(() => {
  vi.stubEnv('FB_PAGE_ACCESS_TOKEN', 'token-uji')
  vi.stubEnv('FB_PAGE_ID', 'page_1')
  // Cabang INSTAGRAM memakai sistem lain: graph.instagram.com dengan token akun Instagram,
  // bukan Page token. Tanpa stub ini setiap tes Instagram mengembalikan null pada gerbang
  // "token kosong" -- dan gagal dengan alasan yang tidak ada hubungannya dengan apa yang diuji.
  vi.stubEnv('IG_USER_TOKEN', 'token-ig-uji')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('fetchMessengerProfileName', () => {
  it('mengembalikan nama participant yang BUKAN page id', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{
          participants: {
            data: [
              { id: '24326633563651786', name: 'David Setya Ramadhan' },
              { id: 'page_1', name: 'Java Volcano Tour Operator' },
            ],
          },
        }],
      }),
    }))

    const name = await fetchMessengerProfileName('24326633563651786', 'FACEBOOK')

    expect(name).toBe('David Setya Ramadhan')
  })

  it('mengembalikan null saat tidak ada participant yang cocok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ participants: { data: [{ id: 'page_1', name: 'Java Volcano Tour Operator' }] } }] }),
    }))

    const name = await fetchMessengerProfileName('psid_tak_dikenal', 'FACEBOOK')

    expect(name).toBeNull()
  })

  it('mengembalikan null (tidak melempar) saat Graph API membalas error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: 'Unsupported get request', code: 100 } }),
    }))

    const name = await fetchMessengerProfileName('psid_abc', 'FACEBOOK')

    expect(name).toBeNull()
  })

  // Review round 2, Temuan 3: cabang gagal harus meninggalkan jejak -- tanpa ini, begitu
  // token produksi kehilangan izin (mis. instagram_basic belum di-grant), SETIAP kontak
  // Instagram lahir tanpa nama dan tidak ada cara membedakannya dari "akun memang tak
  // bernama". Log HANYA platform + status, TIDAK PERNAH url (yang membawa access_token).
  it('menulis console.warn berisi platform dan status HTTP saat Graph API membalas error, tanpa membawa url atau token', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: 'Unsupported get request', code: 100 } }),
    }))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await fetchMessengerProfileName('psid_abc', 'FACEBOOK')

    expect(warnSpy).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ platform: 'FACEBOOK', status: 400 }))
    const loggedArgs = warnSpy.mock.calls.flat().map((arg) => JSON.stringify(arg))
    expect(loggedArgs.join(' ')).not.toContain('token-uji')
    expect(loggedArgs.join(' ')).not.toContain('access_token')
    warnSpy.mockRestore()
  })

  it('mengembalikan null (tidak melempar) saat fetch reject', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))

    const name = await fetchMessengerProfileName('psid_abc', 'FACEBOOK')

    expect(name).toBeNull()
  })

  it('mengembalikan null saat FB_PAGE_ACCESS_TOKEN tidak diatur, tanpa memanggil fetch', async () => {
    vi.unstubAllEnvs()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const name = await fetchMessengerProfileName('psid_abc', 'FACEBOOK')

    expect(name).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // Token TIDAK BOLEH pernah muncul di URL yang bisa mendarat di log -- ikut pola
  // messenger-send.ts: baca hanya error.code dari Graph, jangan pernah error.message mentah,
  // dan jangan pernah melempar apa pun yang membawa token ke pemanggil.
  it('memakai AbortSignal.timeout supaya fetch yang lambat tidak menggantung pemrosesan webhook', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) })
    vi.stubGlobal('fetch', fetchMock)

    await fetchMessengerProfileName('psid_abc', 'FACEBOOK')

    const init = fetchMock.mock.calls[0][1] as { signal?: AbortSignal }
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })
})

describe('cabang Instagram', () => {
  it('memakai endpoint profil IGSID langsung, bukan percakapan Page', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ name: 'Sinta', username: 'sinta.jvto' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const nama = await fetchMessengerProfileName('igsid_777', 'INSTAGRAM')

    expect(nama).toBe('Sinta')
    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('/igsid_777')
    expect(url).toContain('fields=name%2Cusername')
    // Endpoint percakapan Page adalah jalur FACEBOOK. Kalau Instagram ikut lewat sana,
    // IGSID ditanyakan ke Page dan balasannya selalu kosong -- gagal senyap.
    expect(url).not.toContain('/conversations')
  })

  it('jatuh ke username kalau name tidak ada', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ username: 'sinta.jvto' }),
    }))

    expect(await fetchMessengerProfileName('igsid_777', 'INSTAGRAM')).toBe('sinta.jvto')
  })

  it('mengembalikan null, tidak melempar, saat Graph menolak', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({}) }))

    expect(await fetchMessengerProfileName('igsid_777', 'INSTAGRAM')).toBeNull()
  })
})

// Regresi: cabang Facebook tidak boleh berubah perilakunya.
it('Facebook tetap lewat percakapan Page', async () => {
  // beforeEach file ini men-stub FB_PAGE_ID='page_1', tapi payload di bawah memakai page id
  // produksi asli -- override di sini supaya filter "participant yang BUKAN page id" punya
  // page id yang benar-benar cocok dengan datanya.
  vi.stubEnv('FB_PAGE_ID', '698402510359502')
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ data: [{ participants: { data: [
      { id: '698402510359502', name: 'Java Volcano' },
      { id: 'psid_abc', name: 'David' },
    ] } }] }),
  })
  vi.stubGlobal('fetch', fetchMock)

  expect(await fetchMessengerProfileName('psid_abc', 'FACEBOOK')).toBe('David')
  expect(String(fetchMock.mock.calls[0][0])).toContain('/conversations')
})

describe('pemilihan host dan token per platform', () => {
  it('Instagram bertanya ke graph.instagram.com dengan IG_USER_TOKEN', async () => {
    vi.stubEnv('IG_USER_TOKEN', 'token-ig-uji')
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ username: 'sinta' }) })
    vi.stubGlobal('fetch', fetchMock)

    expect(await fetchMessengerProfileName('igsid_1', 'INSTAGRAM')).toBe('sinta')

    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('graph.instagram.com')
    expect(url).not.toContain('graph.facebook.com')
    expect(url).toContain('token-ig-uji')
  })

  it('mengembalikan null tanpa memanggil apa pun kalau IG_USER_TOKEN kosong', async () => {
    vi.stubEnv('IG_USER_TOKEN', '')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    expect(await fetchMessengerProfileName('igsid_1', 'INSTAGRAM')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// Info kontak di panel kanan Inbox. Profil Facebook dari PSID TIDAK bisa dibuka (Graph menjawab
// error 100 -- diverifikasi di produksi 2026-09-29), jadi yang tersedia hanya tautan percakapan
// di inbox Page. Instagram memberi username langsung dari IGSID.
describe('fetchMessengerProfileLink', () => {
  it('Instagram: meminta username dari graph.instagram.com dengan token akun IG', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ username: 'sinta.jvto', id: 'igsid_1' }) })
    vi.stubGlobal('fetch', fetchMock)

    expect(await fetchMessengerProfileLink('igsid_1', 'INSTAGRAM')).toEqual({ igUsername: 'sinta.jvto', fbThreadPath: null })
    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('https://graph.instagram.com/')
    expect(url).toContain('/igsid_1?fields=username')
  })

  it('Facebook: meminta link percakapan Page untuk PSID itu', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ data: [{ id: 't_1', link: '/page_1/inbox/999/?section=messages' }] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    expect(await fetchMessengerProfileLink('psid_abc', 'FACEBOOK')).toEqual({ igUsername: null, fbThreadPath: '/page_1/inbox/999/?section=messages' })
    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('/page_1/conversations?user_id=psid_abc')
    expect(url).toContain('fields=link')
  })

  it('gagal atau tanpa token: nilai kosong, tidak melempar', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({}) }))
    expect(await fetchMessengerProfileLink('igsid_1', 'INSTAGRAM')).toEqual({ igUsername: null, fbThreadPath: null })

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')))
    expect(await fetchMessengerProfileLink('psid_abc', 'FACEBOOK')).toEqual({ igUsername: null, fbThreadPath: null })

    vi.stubEnv('IG_USER_TOKEN', '')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await fetchMessengerProfileLink('igsid_1', 'INSTAGRAM')).toEqual({ igUsername: null, fbThreadPath: null })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

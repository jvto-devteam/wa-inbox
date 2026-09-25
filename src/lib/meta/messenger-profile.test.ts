import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { fetchMessengerProfileName } from './messenger-profile'

beforeEach(() => {
  vi.stubEnv('FB_PAGE_ACCESS_TOKEN', 'token-uji')
  vi.stubEnv('FB_PAGE_ID', 'page_1')
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

    const name = await fetchMessengerProfileName('24326633563651786')

    expect(name).toBe('David Setya Ramadhan')
  })

  it('mengembalikan null saat tidak ada participant yang cocok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ participants: { data: [{ id: 'page_1', name: 'Java Volcano Tour Operator' }] } }] }),
    }))

    const name = await fetchMessengerProfileName('psid_tak_dikenal')

    expect(name).toBeNull()
  })

  it('mengembalikan null (tidak melempar) saat Graph API membalas error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: 'Unsupported get request', code: 100 } }),
    }))

    const name = await fetchMessengerProfileName('psid_abc')

    expect(name).toBeNull()
  })

  it('mengembalikan null (tidak melempar) saat fetch reject', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))

    const name = await fetchMessengerProfileName('psid_abc')

    expect(name).toBeNull()
  })

  it('mengembalikan null saat FB_PAGE_ACCESS_TOKEN tidak diatur, tanpa memanggil fetch', async () => {
    vi.unstubAllEnvs()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const name = await fetchMessengerProfileName('psid_abc')

    expect(name).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // Token TIDAK BOLEH pernah muncul di URL yang bisa mendarat di log -- ikut pola
  // messenger-send.ts: baca hanya error.code dari Graph, jangan pernah error.message mentah,
  // dan jangan pernah melempar apa pun yang membawa token ke pemanggil.
  it('memakai AbortSignal.timeout supaya fetch yang lambat tidak menggantung pemrosesan webhook', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) })
    vi.stubGlobal('fetch', fetchMock)

    await fetchMessengerProfileName('psid_abc')

    const init = fetchMock.mock.calls[0][1] as { signal?: AbortSignal }
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })
})

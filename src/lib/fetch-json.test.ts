import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fetchJson, FetchJsonError } from './fetch-json'

function stubLocation(pathname: string) {
  const location = { pathname, href: `http://localhost${pathname}` }
  vi.stubGlobal('location', location)
  return location
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchJson', () => {
  it('returns the parsed body on a 200', async () => {
    stubLocation('/inbox')
    vi.mocked(fetch).mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'c1' }) } as Response)

    await expect(fetchJson('/api/conversations/c1')).resolves.toEqual({ id: 'c1' })
    expect(location.href).toBe('http://localhost/inbox')
  })

  it('forwards the init argument to fetch untouched', async () => {
    stubLocation('/inbox')
    vi.mocked(fetch).mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) } as Response)

    await fetchJson('/api/send', { method: 'POST', body: '{}' })

    expect(fetch).toHaveBeenCalledWith('/api/send', { method: 'POST', body: '{}' })
  })

  // The whole point of the helper: middleware answers an expired/revoked session with a 401
  // on /api/*, and the caller must be sent back to the login screen rather than handed an
  // `{ error: 'Unauthorized' }` object it will treat as data.
  it('redirects to /login and throws on a 401 instead of returning the error body', async () => {
    const location = stubLocation('/inbox')
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Unauthorized' }),
    } as Response)

    await expect(fetchJson('/api/dashboard/summary')).rejects.toBeInstanceOf(FetchJsonError)
    expect(location.href).toBe('/login')
  })

  it('does not redirect when already on /login, so a 401 there cannot loop', async () => {
    const location = stubLocation('/login')
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: 'Unauthorized' }) } as Response)

    await expect(fetchJson('/api/session')).rejects.toBeInstanceOf(FetchJsonError)
    expect(location.href).toBe('http://localhost/login')
  })

  it('throws a FetchJsonError carrying the status and server error copy on other non-ok statuses', async () => {
    const location = stubLocation('/inbox')
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Terjadi kesalahan' }),
    } as Response)

    await expect(fetchJson('/api/conversations')).rejects.toMatchObject({
      status: 500,
      message: 'Terjadi kesalahan',
    })
    // A 500 is not a session problem — it must never bounce the agent out of the app.
    expect(location.href).toBe('http://localhost/inbox')
  })

  it('falls back to generic copy when a non-ok body is not JSON', async () => {
    stubLocation('/inbox')
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('Unexpected token < in JSON')
      },
    } as unknown as Response)

    await expect(fetchJson('/api/conversations')).rejects.toMatchObject({ status: 502, message: 'Permintaan gagal' })
  })
})

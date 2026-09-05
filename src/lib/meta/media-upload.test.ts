import { describe, it, expect, vi, beforeEach } from 'vitest'
import { uploadMetaMediaFromUrl, uploadMetaResumable } from './media-upload'

import type { MockedFunction } from 'vitest'

// `fetch` is re-stubbed on every beforeEach, so the handle is resolved lazily instead of
// bound once at module scope -- binding it once would keep pointing at the previous test's
// stub. The stubbed value stays loose because these tests hand fetch deliberately partial
// Response fixtures (ok + json only); the call tuple gets its real shape back at the point
// of inspection instead, which is where the types actually earn something.
const mockFetch = () => fetch as unknown as MockedFunction<(...args: never[]) => unknown>
type FetchInit = { method?: string; body: string; signal?: AbortSignal | null; headers: Record<string, string | undefined> }
const fetchCall = (index = 0) => mockFetch().mock.calls[index] as unknown as [string, FetchInit]

beforeEach(() => vi.stubGlobal('fetch', vi.fn()))

describe('uploadMetaMediaFromUrl', () => {
  it('downloads the source URL and uploads it to the phone number media endpoint', async () => {
    const sourceBytes = new TextEncoder().encode('fake-image-bytes').buffer
    ;mockFetch()
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'image/jpeg' }),
        arrayBuffer: async () => sourceBytes,
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'media_123' }) })

    const result = await uploadMetaMediaFromUrl({ phoneNumberId: 'pnid', accessToken: 'tok' }, 'https://example.com/ijen.jpg')

    expect(result).toEqual({ id: 'media_123', mimeType: 'image/jpeg' })
    expect(fetch).toHaveBeenNthCalledWith(1, 'https://example.com/ijen.jpg')
    const [url, options] = fetchCall(1)
    expect(url).toBe('https://graph.facebook.com/v20.0/pnid/media')
    expect(options.method).toBe('POST')
    expect(options.headers).toEqual({ Authorization: 'Bearer tok' })
    expect(options.body).toBeInstanceOf(FormData)
  })

  it('throws when the source URL cannot be downloaded', async () => {
    ;mockFetch().mockResolvedValueOnce({ ok: false })

    await expect(
      uploadMetaMediaFromUrl({ phoneNumberId: 'pnid', accessToken: 'tok' }, 'https://example.com/missing.jpg')
    ).rejects.toThrow('Gagal mengunduh media')
  })

  it('throws with Meta\'s error message when the upload fails', async () => {
    const sourceBytes = new TextEncoder().encode('x').buffer
    ;mockFetch()
      .mockResolvedValueOnce({ ok: true, headers: new Headers({ 'content-type': 'image/jpeg' }), arrayBuffer: async () => sourceBytes })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: { message: 'Invalid parameter' } }) })

    await expect(
      uploadMetaMediaFromUrl({ phoneNumberId: 'pnid', accessToken: 'tok' }, 'https://example.com/ijen.jpg')
    ).rejects.toThrow('Invalid parameter')
  })
})

describe('uploadMetaResumable', () => {
  it('opens an upload session then pushes the bytes, returning the file handle', async () => {
    const sourceBytes = new TextEncoder().encode('fake-image-bytes').buffer
    ;mockFetch()
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'image/jpeg' }),
        arrayBuffer: async () => sourceBytes,
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'upload:xyz' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ h: 'handle_abc' }) })

    const result = await uploadMetaResumable('app_123', 'tok', 'https://example.com/ijen.jpg')

    expect(result).toEqual({ handle: 'handle_abc' })
    const [startUrl, startOptions] = fetchCall(1)
    expect(startUrl).toContain('https://graph.facebook.com/v20.0/app_123/uploads?')
    expect(startUrl).toContain(`file_length=${sourceBytes.byteLength}`)
    expect(startUrl).toContain('file_type=image%2Fjpeg')
    expect(startOptions.method).toBe('POST')

    const [pushUrl, pushOptions] = fetchCall(2)
    expect(pushUrl).toBe('https://graph.facebook.com/v20.0/upload:xyz')
    expect(pushOptions.headers).toEqual({ Authorization: 'OAuth tok', file_offset: '0' })
    expect(pushOptions.body).toBe(sourceBytes)
  })

  it('throws when starting the upload session fails', async () => {
    const sourceBytes = new TextEncoder().encode('x').buffer
    ;mockFetch()
      .mockResolvedValueOnce({ ok: true, headers: new Headers({ 'content-type': 'image/jpeg' }), arrayBuffer: async () => sourceBytes })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: { message: 'Bad file_type' } }) })

    await expect(uploadMetaResumable('app_123', 'tok', 'https://example.com/ijen.jpg')).rejects.toThrow('Bad file_type')
  })
})

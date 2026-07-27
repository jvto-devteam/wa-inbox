import { describe, it, expect, vi, beforeEach } from 'vitest'
import { uploadMetaMediaFromUrl, uploadMetaResumable } from './media-upload'

beforeEach(() => vi.stubGlobal('fetch', vi.fn()))

describe('uploadMetaMediaFromUrl', () => {
  it('downloads the source URL and uploads it to the phone number media endpoint', async () => {
    const sourceBytes = new TextEncoder().encode('fake-image-bytes').buffer
    ;(fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'image/jpeg' }),
        arrayBuffer: async () => sourceBytes,
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'media_123' }) })

    const result = await uploadMetaMediaFromUrl({ phoneNumberId: 'pnid', accessToken: 'tok' }, 'https://example.com/ijen.jpg')

    expect(result).toEqual({ id: 'media_123', mimeType: 'image/jpeg' })
    expect(fetch).toHaveBeenNthCalledWith(1, 'https://example.com/ijen.jpg')
    const [url, options] = (fetch as any).mock.calls[1]
    expect(url).toBe('https://graph.facebook.com/v20.0/pnid/media')
    expect(options.method).toBe('POST')
    expect(options.headers).toEqual({ Authorization: 'Bearer tok' })
    expect(options.body).toBeInstanceOf(FormData)
  })

  it('throws when the source URL cannot be downloaded', async () => {
    ;(fetch as any).mockResolvedValueOnce({ ok: false })

    await expect(
      uploadMetaMediaFromUrl({ phoneNumberId: 'pnid', accessToken: 'tok' }, 'https://example.com/missing.jpg')
    ).rejects.toThrow('Gagal mengunduh media')
  })

  it('throws with Meta\'s error message when the upload fails', async () => {
    const sourceBytes = new TextEncoder().encode('x').buffer
    ;(fetch as any)
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
    ;(fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'image/jpeg' }),
        arrayBuffer: async () => sourceBytes,
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'upload:xyz' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ h: 'handle_abc' }) })

    const result = await uploadMetaResumable('app_123', 'tok', 'https://example.com/ijen.jpg')

    expect(result).toEqual({ handle: 'handle_abc' })
    const [startUrl, startOptions] = (fetch as any).mock.calls[1]
    expect(startUrl).toContain('https://graph.facebook.com/v20.0/app_123/uploads?')
    expect(startUrl).toContain(`file_length=${sourceBytes.byteLength}`)
    expect(startUrl).toContain('file_type=image%2Fjpeg')
    expect(startOptions.method).toBe('POST')

    const [pushUrl, pushOptions] = (fetch as any).mock.calls[2]
    expect(pushUrl).toBe('https://graph.facebook.com/v20.0/upload:xyz')
    expect(pushOptions.headers).toEqual({ Authorization: 'OAuth tok', file_offset: '0' })
    expect(pushOptions.body).toBe(sourceBytes)
  })

  it('throws when starting the upload session fails', async () => {
    const sourceBytes = new TextEncoder().encode('x').buffer
    ;(fetch as any)
      .mockResolvedValueOnce({ ok: true, headers: new Headers({ 'content-type': 'image/jpeg' }), arrayBuffer: async () => sourceBytes })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: { message: 'Bad file_type' } }) })

    await expect(uploadMetaResumable('app_123', 'tok', 'https://example.com/ijen.jpg')).rejects.toThrow('Bad file_type')
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolveMetaMediaUrl, downloadMetaMedia } from './media'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

describe('resolveMetaMediaUrl', () => {
  it('resolves a media id to its short-lived URL and mime type via the Graph API', async () => {
    ;(fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ url: 'https://lookaside.fbsbx.com/whatsapp_business/attachments/xyz', mime_type: 'image/jpeg' }),
    })

    const result = await resolveMetaMediaUrl('media_123', 'tok')

    expect(result).toEqual({ url: 'https://lookaside.fbsbx.com/whatsapp_business/attachments/xyz', mimeType: 'image/jpeg' })
    expect(fetch).toHaveBeenCalledWith(
      'https://graph.facebook.com/v20.0/media_123',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer tok' }) })
    )
  })
})

describe('downloadMetaMedia', () => {
  it('fetches the resolved URL with an Authorization header, not as a JSON call', async () => {
    const fakeResponse = { ok: true } as Response
    ;(fetch as any).mockResolvedValue(fakeResponse)

    const result = await downloadMetaMedia('https://lookaside.fbsbx.com/x', 'tok')

    expect(result).toBe(fakeResponse)
    expect(fetch).toHaveBeenCalledWith('https://lookaside.fbsbx.com/x', { headers: { Authorization: 'Bearer tok' } })
  })
})

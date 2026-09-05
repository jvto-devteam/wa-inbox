import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolveMetaMediaUrl, downloadMetaMedia } from './media'

import type { MockedFunction } from 'vitest'

// `fetch` is re-stubbed on every beforeEach, so the handle is resolved lazily instead of
// bound once at module scope -- binding it once would keep pointing at the previous test's
// stub. The stubbed value stays loose because these tests hand fetch deliberately partial
// Response fixtures (ok + json only); the call tuple gets its real shape back at the point
// of inspection instead, which is where the types actually earn something.
const mockFetch = () => fetch as unknown as MockedFunction<(...args: never[]) => unknown>

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

describe('resolveMetaMediaUrl', () => {
  it('resolves a media id to its short-lived URL and mime type via the Graph API', async () => {
    ;mockFetch().mockResolvedValue({
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
    ;mockFetch().mockResolvedValue(fakeResponse)

    const result = await downloadMetaMedia('https://lookaside.fbsbx.com/x', 'tok')

    expect(result).toBe(fakeResponse)
    expect(fetch).toHaveBeenCalledWith('https://lookaside.fbsbx.com/x', { headers: { Authorization: 'Bearer tok' } })
  })
})

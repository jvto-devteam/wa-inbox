import { describe, it, expect, vi, beforeEach } from 'vitest'
import { sendMetaText } from './messages'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

describe('sendMetaText', () => {
  it('posts to the Graph API messages endpoint and returns the message id', async () => {
    ;(fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [{ id: 'wamid.OUT1' }] }),
    })

    const result = await sendMetaText({ phoneNumberId: '123', accessToken: 'tok' }, '6281234567890', 'Halo!')

    expect(result).toEqual({ externalId: 'wamid.OUT1' })
    expect(fetch).toHaveBeenCalledWith(
      'https://graph.facebook.com/v20.0/123/messages',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer tok' }),
      })
    )
  })

  it('throws with the Graph API error message on failure', async () => {
    ;(fetch as any).mockResolvedValue({
      ok: false,
      json: async () => ({ error: { message: 'Invalid token' } }),
    })

    await expect(sendMetaText({ phoneNumberId: '123', accessToken: 'bad' }, '628', 'x')).rejects.toThrow('Invalid token')
  })
})

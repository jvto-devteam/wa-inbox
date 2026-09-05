import { describe, it, expect, vi, beforeEach } from 'vitest'
import { sendMetaText, sendMetaMedia, sendTemplateMessage } from './messages'

import type { MockedFunction } from 'vitest'

// `fetch` is re-stubbed on every beforeEach, so the handle is resolved lazily instead of
// bound once at module scope -- binding it once would keep pointing at the previous test's
// stub. The stubbed value stays loose because these tests hand fetch deliberately partial
// Response fixtures (ok + json only); the call tuple gets its real shape back at the point
// of inspection instead, which is where the types actually earn something.
const mockFetch = () => fetch as unknown as MockedFunction<(...args: never[]) => unknown>
type FetchInit = { method?: string; body: string; signal?: AbortSignal | null; headers: Record<string, string | undefined> }
const fetchCall = (index = 0) => mockFetch().mock.calls[index] as unknown as [string, FetchInit]

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

describe('sendMetaText', () => {
  it('posts to the Graph API messages endpoint and returns the message id', async () => {
    ;mockFetch().mockResolvedValue({
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

  it('includes a context.message_id when replying to a specific wamid', async () => {
    ;mockFetch().mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [{ id: 'wamid.OUT2' }] }),
    })

    await sendMetaText({ phoneNumberId: '123', accessToken: 'tok' }, '6281234567890', 'Baik, siap!', 'wamid.PARENT')

    const [, options] = fetchCall(0)
    expect(JSON.parse(options.body)).toEqual(expect.objectContaining({ context: { message_id: 'wamid.PARENT' } }))
  })

  it('omits context entirely when there is no reply target', async () => {
    ;mockFetch().mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [{ id: 'wamid.OUT3' }] }),
    })

    await sendMetaText({ phoneNumberId: '123', accessToken: 'tok' }, '6281234567890', 'Halo')

    const [, options] = fetchCall(0)
    expect(JSON.parse(options.body)).not.toHaveProperty('context')
  })

  it('throws with the Graph API error message on failure', async () => {
    ;mockFetch().mockResolvedValue({
      ok: false,
      json: async () => ({ error: { message: 'Invalid token' } }),
    })

    await expect(sendMetaText({ phoneNumberId: '123', accessToken: 'bad' }, '628', 'x')).rejects.toThrow('Invalid token')
  })
})

describe('sendMetaMedia', () => {
  it('sends an image message with a caption', async () => {
    ;mockFetch().mockResolvedValue({ ok: true, json: async () => ({ messages: [{ id: 'wamid.IMG1' }] }) })

    const result = await sendMetaMedia({ phoneNumberId: '123', accessToken: 'tok' }, '6281234567890', 'image', 'media_1', 'Lihat ini')

    expect(result).toEqual({ externalId: 'wamid.IMG1' })
    const [, options] = fetchCall(0)
    expect(JSON.parse(options.body)).toEqual({
      messaging_product: 'whatsapp',
      to: '6281234567890',
      type: 'image',
      image: { id: 'media_1', caption: 'Lihat ini' },
    })
  })

  it('omits caption entirely when none is given', async () => {
    ;mockFetch().mockResolvedValue({ ok: true, json: async () => ({ messages: [{ id: 'wamid.DOC1' }] }) })

    await sendMetaMedia({ phoneNumberId: '123', accessToken: 'tok' }, '628', 'document', 'media_2')

    const [, options] = fetchCall(0)
    expect(JSON.parse(options.body).document).toEqual({ id: 'media_2' })
  })

  it('drops a caption for audio, since Meta silently ignores one there', async () => {
    ;mockFetch().mockResolvedValue({ ok: true, json: async () => ({ messages: [{ id: 'wamid.AUD1' }] }) })

    await sendMetaMedia({ phoneNumberId: '123', accessToken: 'tok' }, '628', 'audio', 'media_3', 'ini caption yang tidak akan terkirim')

    const [, options] = fetchCall(0)
    expect(JSON.parse(options.body).audio).toEqual({ id: 'media_3' })
  })

  it('includes a context.message_id when replying to a specific wamid', async () => {
    ;mockFetch().mockResolvedValue({ ok: true, json: async () => ({ messages: [{ id: 'wamid.VID1' }] }) })

    await sendMetaMedia({ phoneNumberId: '123', accessToken: 'tok' }, '628', 'video', 'media_4', undefined, 'wamid.PARENT')

    const [, options] = fetchCall(0)
    expect(JSON.parse(options.body)).toEqual(expect.objectContaining({ context: { message_id: 'wamid.PARENT' } }))
  })
})

describe('sendTemplateMessage', () => {
  it('sends a plain text-body template with substituted parameters', async () => {
    ;mockFetch().mockResolvedValue({ ok: true, json: async () => ({ messages: [{ id: 'wamid.TPL1' }] }) })

    const result = await sendTemplateMessage(
      { phoneNumberId: '123', accessToken: 'tok' },
      '6281234567890',
      { name: 'booking_confirmation', bodyParams: ['Bruno', '12 Agustus'] }
    )

    expect(result).toEqual({ externalId: 'wamid.TPL1' })
    const [, options] = fetchCall(0)
    expect(JSON.parse(options.body)).toEqual({
      messaging_product: 'whatsapp',
      to: '6281234567890',
      type: 'template',
      template: {
        name: 'booking_confirmation',
        language: { code: 'id' },
        components: [{ type: 'body', parameters: [{ type: 'text', text: 'Bruno' }, { type: 'text', text: '12 Agustus' }] }],
      },
    })
  })

  it('omits the body component entirely when the template has no variables', async () => {
    ;mockFetch().mockResolvedValue({ ok: true, json: async () => ({ messages: [{ id: 'wamid.TPL2' }] }) })

    await sendTemplateMessage({ phoneNumberId: '123', accessToken: 'tok' }, '628', { name: 'no_vars', bodyParams: [] })

    const [, options] = fetchCall(0)
    expect(JSON.parse(options.body).template.components).toEqual([])
  })

  it('sends a carousel with an image header and a quick-reply button parameter', async () => {
    ;mockFetch().mockResolvedValue({ ok: true, json: async () => ({ messages: [{ id: 'wamid.TPL3' }] }) })

    await sendTemplateMessage(
      { phoneNumberId: '123', accessToken: 'tok' },
      '628',
      {
        name: 'katalog_paket',
        bodyParams: ['Bruno'],
        cards: [{ mediaId: 'media_1', mediaType: 'IMAGE', buttons: [{ type: 'QUICK_REPLY', text: 'Pesan Sekarang' }] }],
      }
    )

    const [, options] = fetchCall(0)
    const components = JSON.parse(options.body).template.components
    const carousel = components.find((c: { type: string }) => c.type === 'carousel')
    expect(carousel.cards).toEqual([{
      card_index: 0,
      components: [
        { type: 'header', parameters: [{ type: 'image', image: { id: 'media_1' } }] },
        { type: 'button', sub_type: 'quick_reply', index: 0, parameters: [{ type: 'payload', payload: 'Pesan Sekarang' }] },
      ],
    }])
  })

  it('sends a video header without a button parameter for a static URL button', async () => {
    ;mockFetch().mockResolvedValue({ ok: true, json: async () => ({ messages: [{ id: 'wamid.TPL4' }] }) })

    await sendTemplateMessage(
      { phoneNumberId: '123', accessToken: 'tok' },
      '628',
      {
        name: 'katalog_paket',
        bodyParams: [],
        cards: [{ mediaId: 'media_2', mediaType: 'VIDEO', buttons: [{ type: 'URL', text: 'Lihat', url: 'https://x.com' }] }],
      }
    )

    const [, options] = fetchCall(0)
    const carousel = JSON.parse(options.body).template.components.find((c: { type: string }) => c.type === 'carousel')
    expect(carousel.cards[0].components).toEqual([
      { type: 'header', parameters: [{ type: 'video', video: { id: 'media_2' } }] },
    ])
  })

  it('includes a top-level header component (ahead of body) for a TEXT/AUTH template with a media header', async () => {
    ;mockFetch().mockResolvedValue({ ok: true, json: async () => ({ messages: [{ id: 'wamid.TPL5' }] }) })

    await sendTemplateMessage(
      { phoneNumberId: '123', accessToken: 'tok' },
      '628',
      { name: 'promo', bodyParams: ['Bruno'], header: { mediaId: 'media_3', mediaType: 'IMAGE' } }
    )

    const [, options] = fetchCall(0)
    const components = JSON.parse(options.body).template.components
    expect(components).toEqual([
      { type: 'header', parameters: [{ type: 'image', image: { id: 'media_3' } }] },
      { type: 'body', parameters: [{ type: 'text', text: 'Bruno' }] },
    ])
  })

  it('omits the header component when the template has no media header', async () => {
    ;mockFetch().mockResolvedValue({ ok: true, json: async () => ({ messages: [{ id: 'wamid.TPL6' }] }) })

    await sendTemplateMessage({ phoneNumberId: '123', accessToken: 'tok' }, '628', { name: 'basic', bodyParams: [] })

    const [, options] = fetchCall(0)
    const components = JSON.parse(options.body).template.components
    expect(components.some((c: { type: string }) => c.type === 'header')).toBe(false)
  })

  it('includes a limited_time_offer component with the real per-send expiration timestamp', async () => {
    ;mockFetch().mockResolvedValue({ ok: true, json: async () => ({ messages: [{ id: 'wamid.LTO1' }] }) })

    await sendTemplateMessage(
      { phoneNumberId: '123', accessToken: 'tok' },
      '628',
      { name: 'promo_akhir_tahun', bodyParams: [], limitedTimeOfferExpirationMs: 1735680000000 }
    )

    const [, options] = fetchCall(0)
    const components = JSON.parse(options.body).template.components
    expect(components).toContainEqual({
      type: 'limited_time_offer',
      parameters: [{ type: 'limited_time_offer', limited_time_offer: { expiration_time_ms: 1735680000000 } }],
    })
  })

  it('omits the limited_time_offer component when no expiration is given', async () => {
    ;mockFetch().mockResolvedValue({ ok: true, json: async () => ({ messages: [{ id: 'wamid.LTO2' }] }) })

    await sendTemplateMessage({ phoneNumberId: '123', accessToken: 'tok' }, '628', { name: 'basic', bodyParams: [] })

    const [, options] = fetchCall(0)
    const components = JSON.parse(options.body).template.components
    expect(components.find((c: { type: string }) => c.type === 'limited_time_offer')).toBeUndefined()
  })

  it('includes a copy_code button override with the real per-send coupon code', async () => {
    ;mockFetch().mockResolvedValue({ ok: true, json: async () => ({ messages: [{ id: 'wamid.COUPON1' }] }) })

    await sendTemplateMessage(
      { phoneNumberId: '123', accessToken: 'tok' },
      '628',
      { name: 'kode_diskon', bodyParams: [], couponCode: 'PROMO25' }
    )

    const [, options] = fetchCall(0)
    const components = JSON.parse(options.body).template.components
    expect(components).toContainEqual({
      type: 'button',
      sub_type: 'copy_code',
      index: '0',
      parameters: [{ type: 'coupon_code', coupon_code: 'PROMO25' }],
    })
  })

  it('omits the copy_code button override when no coupon code is given', async () => {
    ;mockFetch().mockResolvedValue({ ok: true, json: async () => ({ messages: [{ id: 'wamid.NOCOUPON' }] }) })

    await sendTemplateMessage({ phoneNumberId: '123', accessToken: 'tok' }, '628', { name: 'basic', bodyParams: [] })

    const [, options] = fetchCall(0)
    const components = JSON.parse(options.body).template.components
    expect(components.some((c: { sub_type?: string }) => c.sub_type === 'copy_code')).toBe(false)
  })
})

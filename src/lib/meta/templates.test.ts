import { describe, it, expect, vi, beforeEach } from 'vitest'
import { submitMetaTemplate, submitCarouselTemplate, submitLtoTemplate, submitCouponTemplate, deleteMetaTemplate, getTemplateLibrary } from './templates'
import { uploadMetaResumable } from './media-upload'

import type { MockedFunction } from 'vitest'

// `fetch` is re-stubbed on every beforeEach, so the handle is resolved lazily instead of
// bound once at module scope -- binding it once would keep pointing at the previous test's
// stub. The stubbed value stays loose because these tests hand fetch deliberately partial
// Response fixtures (ok + json only); the call tuple gets its real shape back at the point
// of inspection instead, which is where the types actually earn something.
const mockFetch = () => fetch as unknown as MockedFunction<(...args: never[]) => unknown>
type FetchInit = { method?: string; body: string; signal?: AbortSignal | null; headers: Record<string, string | undefined> }
const fetchCall = (index = 0) => mockFetch().mock.calls[index] as unknown as [string, FetchInit]

vi.mock('./media-upload', () => ({ uploadMetaResumable: vi.fn() }))

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  vi.mocked(uploadMetaResumable).mockReset()
})

describe('submitMetaTemplate', () => {
  it('posts to the WABA message_templates endpoint with just a BODY component when there is nothing else', async () => {
    ;mockFetch().mockResolvedValue({ ok: true, json: async () => ({ id: 'tpl_meta_1', status: 'PENDING' }) })

    const result = await submitMetaTemplate(
      { wabaId: 'waba_1', accessToken: 'tok' },
      { name: 'sapaan', category: 'UTILITY', body: 'Halo, ada yang bisa dibantu?' }
    )

    expect(result).toEqual({ metaId: 'tpl_meta_1', status: 'PENDING' })
    expect(fetch).toHaveBeenCalledWith('https://graph.facebook.com/v20.0/waba_1/message_templates', expect.objectContaining({ method: 'POST' }))
    const [, options] = fetchCall(0)
    const payload = JSON.parse(options.body)
    expect(payload.components).toEqual([{ type: 'BODY', text: 'Halo, ada yang bisa dibantu?' }])
  })

  it('auto-generates example.body_text from the number of {{n}} placeholders in the body', async () => {
    ;mockFetch().mockResolvedValue({ ok: true, json: async () => ({ id: 'tpl_meta_2', status: 'PENDING' }) })

    await submitMetaTemplate(
      { wabaId: 'waba_1', accessToken: 'tok' },
      { name: 'booking_confirmation', category: 'UTILITY', body: 'Booking Anda {{1}} sudah dikonfirmasi, sisa {{2}}.' }
    )

    const [, options] = fetchCall(0)
    const payload = JSON.parse(options.body)
    expect(payload.components).toEqual([
      { type: 'BODY', text: 'Booking Anda {{1}} sudah dikonfirmasi, sisa {{2}}.', example: { body_text: [['contoh1', 'contoh2']] } },
    ])
  })

  it('includes a plain TEXT header and FOOTER when provided, ahead of and after BODY respectively', async () => {
    ;mockFetch().mockResolvedValue({ ok: true, json: async () => ({ id: 'tpl_meta_3', status: 'PENDING' }) })

    await submitMetaTemplate(
      { wabaId: 'waba_1', accessToken: 'tok' },
      { name: 'sapaan', category: 'UTILITY', body: 'Halo!', header: { type: 'TEXT', text: 'Selamat Datang' }, footer: 'JVTO Tour' }
    )

    const [, options] = fetchCall(0)
    const payload = JSON.parse(options.body)
    expect(payload.components).toEqual([
      { type: 'HEADER', format: 'TEXT', text: 'Selamat Datang' },
      { type: 'BODY', text: 'Halo!' },
      { type: 'FOOTER', text: 'JVTO Tour' },
    ])
  })

  it('uploads a media header via the resumable upload API using the header_handle', async () => {
    vi.mocked(uploadMetaResumable).mockResolvedValue({ handle: 'handle_header_1' })
    ;mockFetch().mockResolvedValue({ ok: true, json: async () => ({ id: 'tpl_meta_4', status: 'PENDING' }) })

    await submitMetaTemplate(
      { wabaId: 'waba_1', accessToken: 'tok' },
      { name: 'promo', category: 'MARKETING', body: 'Halo!', header: { type: 'IMAGE', mediaUrl: 'https://example.com/banner.jpg' } },
      'app_123'
    )

    expect(uploadMetaResumable).toHaveBeenCalledWith('app_123', 'tok', 'https://example.com/banner.jpg')
    const [, options] = fetchCall(0)
    const payload = JSON.parse(options.body)
    expect(payload.components[0]).toEqual({ type: 'HEADER', format: 'IMAGE', example: { header_handle: ['handle_header_1'] } })
  })

  it('throws a clear error when a media header is requested without META_APP_ID', async () => {
    await expect(
      submitMetaTemplate(
        { wabaId: 'waba_1', accessToken: 'tok' },
        { name: 'promo', category: 'MARKETING', body: 'Halo!', header: { type: 'IMAGE', mediaUrl: 'https://example.com/banner.jpg' } }
      )
    ).rejects.toThrow('META_APP_ID')
  })

  it('includes a BUTTONS component when buttons are provided', async () => {
    ;mockFetch().mockResolvedValue({ ok: true, json: async () => ({ id: 'tpl_meta_5', status: 'PENDING' }) })

    await submitMetaTemplate(
      { wabaId: 'waba_1', accessToken: 'tok' },
      { name: 'sapaan', category: 'UTILITY', body: 'Halo!', buttons: [{ type: 'QUICK_REPLY', text: 'Ya' }] }
    )

    const [, options] = fetchCall(0)
    const payload = JSON.parse(options.body)
    expect(payload.components).toEqual([
      { type: 'BODY', text: 'Halo!' },
      { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Ya' }] },
    ])
  })
})

describe('submitCarouselTemplate', () => {
  const card = {
    mediaType: 'IMAGE' as const,
    mediaUrl: 'https://example.com/ijen.jpg',
    bodyText: 'Paket Ijen 3D2N',
    buttons: [{ type: 'QUICK_REPLY' as const, text: 'Pesan Sekarang' }],
  }

  it('uploads each card header via the resumable upload API and submits a CAROUSEL component', async () => {
    vi.mocked(uploadMetaResumable).mockResolvedValue({ handle: 'handle_abc' })
    ;mockFetch().mockResolvedValue({ ok: true, json: async () => ({ id: 'tpl_carousel_1', status: 'PENDING' }) })

    const result = await submitCarouselTemplate(
      { wabaId: 'waba_1', accessToken: 'tok' },
      'app_123',
      { name: 'katalog_paket', category: 'MARKETING', body: 'Halo, ini rekomendasi untuk Anda:', cards: [card] }
    )

    expect(result).toEqual({ metaId: 'tpl_carousel_1', status: 'PENDING' })
    expect(uploadMetaResumable).toHaveBeenCalledWith('app_123', 'tok', card.mediaUrl)

    const [, options] = fetchCall(0)
    const payload = JSON.parse(options.body)
    expect(payload.components[0]).toEqual({ type: 'BODY', text: 'Halo, ini rekomendasi untuk Anda:' })
    expect(payload.components[1].type).toBe('CAROUSEL')
    expect(payload.components[1].cards[0].components).toEqual([
      { type: 'HEADER', format: 'IMAGE', example: { header_handle: ['handle_abc'] } },
      { type: 'BODY', text: 'Paket Ijen 3D2N' },
      { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Pesan Sekarang' }] },
    ])
  })

  it('omits the BUTTONS component for a card with no buttons', async () => {
    vi.mocked(uploadMetaResumable).mockResolvedValue({ handle: 'handle_abc' })
    ;mockFetch().mockResolvedValue({ ok: true, json: async () => ({ id: 'tpl_carousel_2', status: 'PENDING' }) })

    await submitCarouselTemplate(
      { wabaId: 'waba_1', accessToken: 'tok' },
      'app_123',
      { name: 'katalog_paket', category: 'MARKETING', body: 'Halo', cards: [{ ...card, buttons: [] }] }
    )

    const [, options] = fetchCall(0)
    const payload = JSON.parse(options.body)
    expect(payload.components[1].cards[0].components).toEqual([
      { type: 'HEADER', format: 'IMAGE', example: { header_handle: ['handle_abc'] } },
      { type: 'BODY', text: 'Paket Ijen 3D2N' },
    ])
  })

  it('maps URL and PHONE_NUMBER button types to Meta\'s expected shape', async () => {
    vi.mocked(uploadMetaResumable).mockResolvedValue({ handle: 'handle_abc' })
    ;mockFetch().mockResolvedValue({ ok: true, json: async () => ({ id: 'tpl_carousel_3', status: 'PENDING' }) })

    await submitCarouselTemplate(
      { wabaId: 'waba_1', accessToken: 'tok' },
      'app_123',
      {
        name: 'katalog_paket', category: 'MARKETING', body: 'Halo',
        cards: [{
          ...card,
          buttons: [
            { type: 'URL', text: 'Lihat Detail', url: 'https://jvto.com/ijen' },
            { type: 'PHONE_NUMBER', text: 'Telepon Kami', phoneNumber: '+622112345678' },
          ],
        }],
      }
    )

    const [, options] = fetchCall(0)
    const payload = JSON.parse(options.body)
    expect(payload.components[1].cards[0].components[2]).toEqual({
      type: 'BUTTONS',
      buttons: [
        { type: 'URL', text: 'Lihat Detail', url: 'https://jvto.com/ijen' },
        { type: 'PHONE_NUMBER', text: 'Telepon Kami', phone_number: '+622112345678' },
      ],
    })
  })
})

describe('submitLtoTemplate', () => {
  it('submits a LIMITED_TIME_OFFER component with has_expiration always true, ahead of BODY and BUTTONS', async () => {
    ;mockFetch().mockResolvedValue({ ok: true, json: async () => ({ id: 'tpl_lto_1', status: 'PENDING' }) })

    const result = await submitLtoTemplate(
      { wabaId: 'waba_1', accessToken: 'tok' },
      {
        name: 'promo_akhir_tahun', category: 'MARKETING', body: 'Nikmati diskon spesial akhir tahun!',
        offerTitle: 'Diskon 25%', buttons: [{ type: 'URL', text: 'Lihat Promo', url: 'https://example.com/promo' }],
      }
    )

    expect(result).toEqual({ metaId: 'tpl_lto_1', status: 'PENDING' })
    const [, options] = fetchCall(0)
    const payload = JSON.parse(options.body)
    expect(payload.category).toBe('MARKETING')
    expect(payload.components).toEqual([
      { type: 'LIMITED_TIME_OFFER', limited_time_offer: { text: 'Diskon 25%', has_expiration: true } },
      { type: 'BODY', text: 'Nikmati diskon spesial akhir tahun!' },
      { type: 'BUTTONS', buttons: [{ type: 'URL', text: 'Lihat Promo', url: 'https://example.com/promo' }] },
    ])
  })

  it('omits the BUTTONS component when there are no buttons', async () => {
    ;mockFetch().mockResolvedValue({ ok: true, json: async () => ({ id: 'tpl_lto_2', status: 'PENDING' }) })

    await submitLtoTemplate(
      { wabaId: 'waba_1', accessToken: 'tok' },
      { name: 'promo', category: 'MARKETING', body: 'Halo', offerTitle: 'Promo', buttons: [] }
    )

    const [, options] = fetchCall(0)
    const payload = JSON.parse(options.body)
    expect(payload.components).toEqual([
      { type: 'LIMITED_TIME_OFFER', limited_time_offer: { text: 'Promo', has_expiration: true } },
      { type: 'BODY', text: 'Halo' },
    ])
  })
})

describe('submitCouponTemplate', () => {
  it('submits a BODY plus a BUTTONS component holding one COPY_CODE button with the example code', async () => {
    ;mockFetch().mockResolvedValue({ ok: true, json: async () => ({ id: 'tpl_coupon_1', status: 'PENDING' }) })

    const result = await submitCouponTemplate(
      { wabaId: 'waba_1', accessToken: 'tok' },
      { name: 'kode_diskon', category: 'UTILITY', body: 'Gunakan kode ini untuk diskon spesial Anda.', buttonText: 'Salin Kode', exampleCode: 'PROMO25' }
    )

    expect(result).toEqual({ metaId: 'tpl_coupon_1', status: 'PENDING' })
    const [, options] = fetchCall(0)
    const payload = JSON.parse(options.body)
    expect(payload.components).toEqual([
      { type: 'BODY', text: 'Gunakan kode ini untuk diskon spesial Anda.' },
      { type: 'BUTTONS', buttons: [{ type: 'COPY_CODE', text: 'Salin Kode', example: ['PROMO25'] }] },
    ])
  })

  it('includes a FOOTER component between BODY and BUTTONS when provided', async () => {
    ;mockFetch().mockResolvedValue({ ok: true, json: async () => ({ id: 'tpl_coupon_2', status: 'PENDING' }) })

    await submitCouponTemplate(
      { wabaId: 'waba_1', accessToken: 'tok' },
      { name: 'kode_diskon', category: 'UTILITY', body: 'Halo', footer: 'JVTO Tour', buttonText: 'Salin Kode', exampleCode: 'PROMO25' }
    )

    const [, options] = fetchCall(0)
    const payload = JSON.parse(options.body)
    expect(payload.components).toEqual([
      { type: 'BODY', text: 'Halo' },
      { type: 'FOOTER', text: 'JVTO Tour' },
      { type: 'BUTTONS', buttons: [{ type: 'COPY_CODE', text: 'Salin Kode', example: ['PROMO25'] }] },
    ])
  })
})

describe('deleteMetaTemplate', () => {
  it('sends a DELETE to the WABA message_templates endpoint, keyed by name', async () => {
    ;mockFetch().mockResolvedValue({ ok: true, json: async () => ({ success: true }) })

    await deleteMetaTemplate({ wabaId: 'waba_1', accessToken: 'tok' }, 'booking_confirmation')

    expect(fetch).toHaveBeenCalledWith(
      'https://graph.facebook.com/v20.0/waba_1/message_templates?name=booking_confirmation',
      expect.objectContaining({ method: 'DELETE' })
    )
  })

  it('URL-encodes a template name with special characters', async () => {
    ;mockFetch().mockResolvedValue({ ok: true, json: async () => ({ success: true }) })

    await deleteMetaTemplate({ wabaId: 'waba_1', accessToken: 'tok' }, 'promo & diskon')

    const [url] = fetchCall(0)
    expect(url).toBe('https://graph.facebook.com/v20.0/waba_1/message_templates?name=promo%20%26%20diskon')
  })

  it('throws when Meta rejects the deletion', async () => {
    ;mockFetch().mockResolvedValue({ ok: false, json: async () => ({ error: { message: 'Template not found' } }) })

    await expect(deleteMetaTemplate({ wabaId: 'waba_1', accessToken: 'tok' }, 'gone_already')).rejects.toThrow('Template not found')
  })
})

describe('getTemplateLibrary', () => {
  it('requests the global message_template_library endpoint (no WABA id in the path)', async () => {
    ;mockFetch().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{
          id: '7213311995461680', name: 'account_creation_confirmation_3', category: 'UTILITY', language: 'en_US',
          header: 'Finish setting up your account', body: 'Hi {{1}}, your account is ready.',
          buttons: [{ type: 'URL', text: 'Confirm', url: 'https://example.com' }],
        }],
        paging: { cursors: { after: 'MgZDZD' } },
      }),
    })

    const result = await getTemplateLibrary('tok', { category: 'UTILITY', language: 'en_US' })

    const [url, options] = fetchCall(0)
    expect(url).toBe('https://graph.facebook.com/v20.0/message_template_library?category=UTILITY&language=en_US&limit=25')
    expect(options.headers.Authorization).toBe('Bearer tok')
    expect(result).toEqual({
      templates: [{
        id: '7213311995461680', name: 'account_creation_confirmation_3', category: 'UTILITY', language: 'en_US',
        header: 'Finish setting up your account', body: 'Hi {{1}}, your account is ready.',
        buttons: [{ type: 'URL', text: 'Confirm', url: 'https://example.com' }],
      }],
      nextCursor: 'MgZDZD',
    })
  })

  it('defaults header to null and buttons to an empty array when Meta omits them', async () => {
    ;mockFetch().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: '1', name: 'plain', category: 'UTILITY', language: 'en_US', body: 'Hello.' }] }),
    })

    const result = await getTemplateLibrary('tok')

    expect(result.templates[0]).toEqual({
      id: '1', name: 'plain', category: 'UTILITY', language: 'en_US', header: null, body: 'Hello.', buttons: [],
    })
  })

  it('returns an empty list and null cursor when Meta reports no templates at all', async () => {
    ;mockFetch().mockResolvedValue({ ok: true, json: async () => ({}) })

    const result = await getTemplateLibrary('tok')

    expect(result).toEqual({ templates: [], nextCursor: null })
  })
})

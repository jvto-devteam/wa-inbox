import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  getBusinessProfile,
  updateBusinessProfile,
  getBusinessAccountDetails,
  getCommerceSettings,
  updateCommerceSettings,
} from './business-account'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

describe('getBusinessProfile', () => {
  it('requests the whatsapp_business_profile edge and normalizes the response', async () => {
    ;(fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{
          about: ' ', address: 'Jl. Khairil Anwar No.102A', description: 'Explore East Java',
          email: 'hello@javavolcano-touroperator.com', vertical: 'TRAVEL',
          websites: ['http://www.javavolcano-touroperator.com'],
        }],
      }),
    })

    const result = await getBusinessProfile({ phoneNumberId: 'pnid_1', accessToken: 'tok' })

    const [url, options] = (fetch as any).mock.calls[0]
    expect(url).toBe('https://graph.facebook.com/v20.0/pnid_1/whatsapp_business_profile?fields=about,address,description,email,profile_picture_url,websites,vertical')
    expect(options.headers.Authorization).toBe('Bearer tok')
    expect(result).toEqual({
      about: ' ', address: 'Jl. Khairil Anwar No.102A', description: 'Explore East Java',
      email: 'hello@javavolcano-touroperator.com', vertical: 'TRAVEL',
      websites: ['http://www.javavolcano-touroperator.com'], profilePictureUrl: null,
    })
  })

  it('degrades to all-null/empty when Meta returns no data', async () => {
    ;(fetch as any).mockResolvedValue({ ok: true, json: async () => ({ data: [] }) })

    const result = await getBusinessProfile({ phoneNumberId: 'pnid_1', accessToken: 'tok' })

    expect(result).toEqual({
      about: null, address: null, description: null, email: null, vertical: null, websites: [], profilePictureUrl: null,
    })
  })
})

describe('updateBusinessProfile', () => {
  it('posts only the provided fields, plus the required messaging_product', async () => {
    ;(fetch as any).mockResolvedValue({ ok: true, json: async () => ({ success: true }) })

    await updateBusinessProfile({ phoneNumberId: 'pnid_1', accessToken: 'tok' }, { about: 'Halo!' })

    const [url, options] = (fetch as any).mock.calls[0]
    expect(url).toBe('https://graph.facebook.com/v20.0/pnid_1/whatsapp_business_profile')
    expect(options.method).toBe('POST')
    expect(JSON.parse(options.body)).toEqual({ messaging_product: 'whatsapp', about: 'Halo!' })
  })
})

describe('getBusinessAccountDetails', () => {
  it('requests the WABA node with the account-status fields', async () => {
    ;(fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        id: '1698626730331009', name: 'Java Volcano Tour Operator', timezone_id: '66',
        account_review_status: 'APPROVED', business_verification_status: 'verified',
      }),
    })

    const result = await getBusinessAccountDetails({ wabaId: 'waba_1', accessToken: 'tok' })

    const [url] = (fetch as any).mock.calls[0]
    expect(url).toBe('https://graph.facebook.com/v20.0/waba_1?fields=id,name,timezone_id,account_review_status,business_verification_status')
    expect(result).toEqual({
      id: '1698626730331009', name: 'Java Volcano Tour Operator', timezoneId: '66',
      accountReviewStatus: 'APPROVED', businessVerificationStatus: 'verified',
    })
  })
})

describe('getCommerceSettings', () => {
  it('requests the whatsapp_commerce_settings edge and normalizes the response', async () => {
    ;(fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: '622917713403586', is_cart_enabled: true, is_catalog_visible: true }] }),
    })

    const result = await getCommerceSettings({ phoneNumberId: 'pnid_1', accessToken: 'tok' })

    expect(result).toEqual({ isCartEnabled: true, isCatalogVisible: true })
  })

  it('defaults both flags to false when Meta returns no data', async () => {
    ;(fetch as any).mockResolvedValue({ ok: true, json: async () => ({ data: [] }) })

    const result = await getCommerceSettings({ phoneNumberId: 'pnid_1', accessToken: 'tok' })

    expect(result).toEqual({ isCartEnabled: false, isCatalogVisible: false })
  })
})

describe('updateCommerceSettings', () => {
  it('posts only the provided flags', async () => {
    ;(fetch as any).mockResolvedValue({ ok: true, json: async () => ({ success: true }) })

    await updateCommerceSettings({ phoneNumberId: 'pnid_1', accessToken: 'tok' }, { isCartEnabled: false })

    const [url, options] = (fetch as any).mock.calls[0]
    expect(url).toBe('https://graph.facebook.com/v20.0/pnid_1/whatsapp_commerce_settings')
    expect(JSON.parse(options.body)).toEqual({ is_cart_enabled: false })
  })

  it('posts both flags when both are provided', async () => {
    ;(fetch as any).mockResolvedValue({ ok: true, json: async () => ({ success: true }) })

    await updateCommerceSettings({ phoneNumberId: 'pnid_1', accessToken: 'tok' }, { isCartEnabled: true, isCatalogVisible: false })

    const [, options] = (fetch as any).mock.calls[0]
    expect(JSON.parse(options.body)).toEqual({ is_cart_enabled: true, is_catalog_visible: false })
  })
})

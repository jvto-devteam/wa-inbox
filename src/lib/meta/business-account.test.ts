import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  getBusinessProfile,
  updateBusinessProfile,
  getBusinessAccountDetails,
  getCommerceSettings,
  updateCommerceSettings,
} from './business-account'

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

describe('getBusinessProfile', () => {
  it('requests the whatsapp_business_profile edge and normalizes the response', async () => {
    ;mockFetch().mockResolvedValue({
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

    const [url, options] = fetchCall(0)
    expect(url).toBe('https://graph.facebook.com/v20.0/pnid_1/whatsapp_business_profile?fields=about,address,description,email,profile_picture_url,websites,vertical')
    expect(options.headers.Authorization).toBe('Bearer tok')
    expect(result).toEqual({
      about: ' ', address: 'Jl. Khairil Anwar No.102A', description: 'Explore East Java',
      email: 'hello@javavolcano-touroperator.com', vertical: 'TRAVEL',
      websites: ['http://www.javavolcano-touroperator.com'], profilePictureUrl: null,
    })
  })

  it('degrades to all-null/empty when Meta returns no data', async () => {
    ;mockFetch().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) })

    const result = await getBusinessProfile({ phoneNumberId: 'pnid_1', accessToken: 'tok' })

    expect(result).toEqual({
      about: null, address: null, description: null, email: null, vertical: null, websites: [], profilePictureUrl: null,
    })
  })
})

describe('updateBusinessProfile', () => {
  it('posts only the provided fields, plus the required messaging_product', async () => {
    ;mockFetch().mockResolvedValue({ ok: true, json: async () => ({ success: true }) })

    await updateBusinessProfile({ phoneNumberId: 'pnid_1', accessToken: 'tok' }, { about: 'Halo!' })

    const [url, options] = fetchCall(0)
    expect(url).toBe('https://graph.facebook.com/v20.0/pnid_1/whatsapp_business_profile')
    expect(options.method).toBe('POST')
    expect(JSON.parse(options.body)).toEqual({ messaging_product: 'whatsapp', about: 'Halo!' })
  })
})

describe('getBusinessAccountDetails', () => {
  it('requests the WABA node with the account-status fields', async () => {
    ;mockFetch().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: '1698626730331009', name: 'Java Volcano Tour Operator', timezone_id: '66',
        account_review_status: 'APPROVED', business_verification_status: 'verified',
      }),
    })

    const result = await getBusinessAccountDetails({ wabaId: 'waba_1', accessToken: 'tok' })

    const [url] = fetchCall(0)
    expect(url).toBe('https://graph.facebook.com/v20.0/waba_1?fields=id,name,timezone_id,account_review_status,business_verification_status')
    expect(result).toEqual({
      id: '1698626730331009', name: 'Java Volcano Tour Operator', timezoneId: '66',
      accountReviewStatus: 'APPROVED', businessVerificationStatus: 'verified',
    })
  })
})

describe('getCommerceSettings', () => {
  it('requests the whatsapp_commerce_settings edge and normalizes the response', async () => {
    ;mockFetch().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: '622917713403586', is_cart_enabled: true, is_catalog_visible: true }] }),
    })

    const result = await getCommerceSettings({ phoneNumberId: 'pnid_1', accessToken: 'tok' })

    expect(result).toEqual({ isCartEnabled: true, isCatalogVisible: true })
  })

  it('defaults both flags to false when Meta returns no data', async () => {
    ;mockFetch().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) })

    const result = await getCommerceSettings({ phoneNumberId: 'pnid_1', accessToken: 'tok' })

    expect(result).toEqual({ isCartEnabled: false, isCatalogVisible: false })
  })
})

describe('updateCommerceSettings', () => {
  it('posts only the provided flags', async () => {
    ;mockFetch().mockResolvedValue({ ok: true, json: async () => ({ success: true }) })

    await updateCommerceSettings({ phoneNumberId: 'pnid_1', accessToken: 'tok' }, { isCartEnabled: false })

    const [url, options] = fetchCall(0)
    expect(url).toBe('https://graph.facebook.com/v20.0/pnid_1/whatsapp_commerce_settings')
    expect(JSON.parse(options.body)).toEqual({ is_cart_enabled: false })
  })

  it('posts both flags when both are provided', async () => {
    ;mockFetch().mockResolvedValue({ ok: true, json: async () => ({ success: true }) })

    await updateCommerceSettings({ phoneNumberId: 'pnid_1', accessToken: 'tok' }, { isCartEnabled: true, isCatalogVisible: false })

    const [, options] = fetchCall(0)
    expect(JSON.parse(options.body)).toEqual({ is_cart_enabled: true, is_catalog_visible: false })
  })
})

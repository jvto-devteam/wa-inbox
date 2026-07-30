import { metaFetch } from './client'

// Runtime array (not just a type) so callers -- the zod schema on
// /api/settings/business-profile, the Select in the business-profile settings page -- can
// validate/enumerate against the exact same set Meta itself accepts, with one source of truth.
export const BUSINESS_VERTICALS = [
  'OTHER', 'AUTO', 'BEAUTY', 'APPAREL', 'EDU', 'ENTERTAIN', 'EVENT_PLAN', 'FINANCE',
  'GROCERY', 'GOVT', 'HOTEL', 'HEALTH', 'NONPROFIT', 'PROF_SERVICES', 'RETAIL',
  'TRAVEL', 'RESTAURANT', 'ALCOHOL', 'ONLINE_GAMBLING', 'PHYSICAL_GAMBLING', 'OTC_DRUGS',
] as const

export type BusinessVertical = (typeof BUSINESS_VERTICALS)[number]

export type BusinessProfile = {
  about: string | null
  address: string | null
  description: string | null
  email: string | null
  vertical: BusinessVertical | null
  websites: string[]
  profilePictureUrl: string | null
}

const PROFILE_FIELDS = 'about,address,description,email,profile_picture_url,websites,vertical'

/** Meta's `whatsapp_business_profile` edge on the phone number node. */
export async function getBusinessProfile(waNumber: { phoneNumberId: string; accessToken: string }): Promise<BusinessProfile> {
  const body = await metaFetch(`/${waNumber.phoneNumberId}/whatsapp_business_profile?fields=${PROFILE_FIELDS}`, waNumber.accessToken)
  // Meta wraps single-object edges like this one in a one-element `data` array.
  const profile = body.data?.[0] ?? {}
  return {
    about: profile.about ?? null,
    address: profile.address ?? null,
    description: profile.description ?? null,
    email: profile.email ?? null,
    vertical: profile.vertical ?? null,
    websites: profile.websites ?? [],
    profilePictureUrl: profile.profile_picture_url ?? null,
  }
}

/**
 * Only fields actually present in `fields` are sent, matching Meta's own "only provided
 * fields are updated" semantics -- an admin editing just the `about` text must not silently
 * blank out the address/description/etc. nobody touched.
 */
export async function updateBusinessProfile(
  waNumber: { phoneNumberId: string; accessToken: string },
  fields: Partial<Pick<BusinessProfile, 'about' | 'address' | 'description' | 'email' | 'vertical' | 'websites'>>
): Promise<void> {
  await metaFetch(`/${waNumber.phoneNumberId}/whatsapp_business_profile`, waNumber.accessToken, {
    method: 'POST',
    body: JSON.stringify({ messaging_product: 'whatsapp', ...fields }),
  })
}

export type BusinessAccountDetails = {
  id: string
  name: string | null
  timezoneId: string | null
  accountReviewStatus: string | null
  businessVerificationStatus: string | null
}

const ACCOUNT_FIELDS = 'id,name,timezone_id,account_review_status,business_verification_status'

/** The WABA node itself -- review/verification status Meta Business Suite otherwise shows. */
export async function getBusinessAccountDetails(waNumber: { wabaId: string; accessToken: string }): Promise<BusinessAccountDetails> {
  const body = await metaFetch(`/${waNumber.wabaId}?fields=${ACCOUNT_FIELDS}`, waNumber.accessToken)
  return {
    id: body.id,
    name: body.name ?? null,
    timezoneId: body.timezone_id ?? null,
    accountReviewStatus: body.account_review_status ?? null,
    businessVerificationStatus: body.business_verification_status ?? null,
  }
}

export type CommerceSettings = { isCartEnabled: boolean; isCatalogVisible: boolean }

/** Meta's `whatsapp_commerce_settings` edge on the phone number node. */
export async function getCommerceSettings(waNumber: { phoneNumberId: string; accessToken: string }): Promise<CommerceSettings> {
  const body = await metaFetch(`/${waNumber.phoneNumberId}/whatsapp_commerce_settings`, waNumber.accessToken)
  const settings = body.data?.[0] ?? {}
  return {
    isCartEnabled: settings.is_cart_enabled ?? false,
    isCatalogVisible: settings.is_catalog_visible ?? false,
  }
}

export async function updateCommerceSettings(
  waNumber: { phoneNumberId: string; accessToken: string },
  settings: Partial<{ isCartEnabled: boolean; isCatalogVisible: boolean }>
): Promise<void> {
  const body: Record<string, boolean> = {}
  if (settings.isCartEnabled !== undefined) body.is_cart_enabled = settings.isCartEnabled
  if (settings.isCatalogVisible !== undefined) body.is_catalog_visible = settings.isCatalogVisible
  await metaFetch(`/${waNumber.phoneNumberId}/whatsapp_commerce_settings`, waNumber.accessToken, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

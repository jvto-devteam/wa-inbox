import { metaFetch } from './client'
import { uploadMetaResumable } from './media-upload'
import type { CarouselCardDef, CarouselButtonDef, TemplateHeaderDef } from './carousel-types'

// Meta requires a concrete sample value per {{n}} placeholder in a BODY component before it
// will review a submission -- generic, position-numbered placeholders (never the real data a
// customer would see) are all Meta actually needs at submission time; the true content is
// filled in per-send instead (see ComposeBox).
function bodyExample(body: string): string[] | undefined {
  const count = (body.match(/\{\{\d+\}\}/g) ?? []).length
  if (count === 0) return undefined
  return Array.from({ length: count }, (_, i) => `contoh${i + 1}`)
}

function buildButtonComponents(buttons: CarouselButtonDef[]) {
  if (buttons.length === 0) return []
  return [
    {
      type: 'BUTTONS',
      buttons: buttons.map((b) =>
        b.type === 'URL'
          ? { type: 'URL', text: b.text, url: b.url }
          : b.type === 'PHONE_NUMBER'
            ? { type: 'PHONE_NUMBER', text: b.text, phone_number: b.phoneNumber }
            : { type: 'QUICK_REPLY', text: b.text }
      ),
    },
  ]
}

async function buildHeaderComponent(
  header: TemplateHeaderDef | undefined,
  accessToken: string,
  appId?: string
): Promise<Record<string, unknown>[]> {
  if (!header || header.type === 'NONE') return []
  if (header.type === 'TEXT') return [{ type: 'HEADER', format: 'TEXT', text: header.text }]
  if (!appId) throw new Error('META_APP_ID belum dikonfigurasi di server')
  const { handle } = await uploadMetaResumable(appId, accessToken, header.mediaUrl)
  return [{ type: 'HEADER', format: header.type, example: { header_handle: [handle] } }]
}

export async function submitMetaTemplate(
  waNumber: { wabaId: string; accessToken: string },
  template: {
    name: string
    category: string
    body: string
    header?: TemplateHeaderDef
    footer?: string
    buttons?: CarouselButtonDef[]
  },
  appId?: string
): Promise<{ metaId: string; status: string }> {
  const example = bodyExample(template.body)
  const components = [
    ...(await buildHeaderComponent(template.header, waNumber.accessToken, appId)),
    { type: 'BODY', text: template.body, ...(example ? { example: { body_text: [example] } } : {}) },
    ...(template.footer ? [{ type: 'FOOTER', text: template.footer }] : []),
    ...buildButtonComponents(template.buttons ?? []),
  ]

  const body = await metaFetch(`/${waNumber.wabaId}/message_templates`, waNumber.accessToken, {
    method: 'POST',
    body: JSON.stringify({ name: template.name, language: 'id', category: template.category, components }),
  })
  return { metaId: body.id, status: body.status }
}

/**
 * Submits a Limited Time Offer template -- Meta's real LIMITED_TIME_OFFER component (a
 * countdown banner), not something waba-jvto's own code actually builds despite offering it
 * as a type in its picker (confirmed by reading that source directly: it silently falls
 * through to the same components as a plain BASIC template). `hasExpiration` is always true
 * here: an offer with no expiration isn't a "limited time" offer, and the alternative would
 * need extra UI for zero practical benefit. The real expiration timestamp is a per-send
 * value (see sendTemplateMessage's `limitedTimeOfferExpirationMs`), never stored here --
 * Meta only needs the `has_expiration` boolean at submission time.
 */
export async function submitLtoTemplate(
  waNumber: { wabaId: string; accessToken: string },
  template: { name: string; category: string; body: string; offerTitle: string; buttons: CarouselButtonDef[] }
): Promise<{ metaId: string; status: string }> {
  const components = [
    { type: 'LIMITED_TIME_OFFER', limited_time_offer: { text: template.offerTitle, has_expiration: true } },
    { type: 'BODY', text: template.body },
    ...buildButtonComponents(template.buttons),
  ]

  const body = await metaFetch(`/${waNumber.wabaId}/message_templates`, waNumber.accessToken, {
    method: 'POST',
    body: JSON.stringify({ name: template.name, language: 'id', category: template.category, components }),
  })
  return { metaId: body.id, status: body.status }
}

/**
 * Submits a "coupon" template. Meta has no distinct COUPON component -- this is structurally
 * just a BODY plus a BUTTONS component holding one COPY_CODE button. `exampleCode` is only
 * ever the placeholder Meta needs to approve the submission (its own review requires a
 * sample value); the real, live code a customer actually receives is supplied per-send (see
 * sendTemplateMessage's `couponCode`), never reused from here.
 */
export async function submitCouponTemplate(
  waNumber: { wabaId: string; accessToken: string },
  template: { name: string; category: string; body: string; footer?: string; buttonText: string; exampleCode: string }
): Promise<{ metaId: string; status: string }> {
  const components = [
    { type: 'BODY', text: template.body },
    ...(template.footer ? [{ type: 'FOOTER', text: template.footer }] : []),
    { type: 'BUTTONS', buttons: [{ type: 'COPY_CODE', text: template.buttonText, example: [template.exampleCode] }] },
  ]

  const body = await metaFetch(`/${waNumber.wabaId}/message_templates`, waNumber.accessToken, {
    method: 'POST',
    body: JSON.stringify({ name: template.name, language: 'id', category: template.category, components }),
  })
  return { metaId: body.id, status: body.status }
}

/**
 * Submits a CAROUSEL template for Meta's review. Every card's header media must first be
 * uploaded via the Resumable Upload API to get a `header_handle` -- Meta has no "submit a
 * template with a plain image URL" option, unlike sending a message.
 */
export async function submitCarouselTemplate(
  waNumber: { wabaId: string; accessToken: string },
  appId: string,
  template: { name: string; category: string; body: string; cards: CarouselCardDef[] }
): Promise<{ metaId: string; status: string }> {
  const cards = await Promise.all(
    template.cards.map(async (card) => {
      const { handle } = await uploadMetaResumable(appId, waNumber.accessToken, card.mediaUrl)
      return {
        components: [
          { type: 'HEADER', format: card.mediaType, example: { header_handle: [handle] } },
          { type: 'BODY', text: card.bodyText },
          ...buildButtonComponents(card.buttons),
        ],
      }
    })
  )

  const body = await metaFetch(`/${waNumber.wabaId}/message_templates`, waNumber.accessToken, {
    method: 'POST',
    body: JSON.stringify({
      name: template.name,
      language: 'id',
      category: template.category,
      components: [
        { type: 'BODY', text: template.body },
        { type: 'CAROUSEL', cards },
      ],
    }),
  })
  return { metaId: body.id, status: body.status }
}

/**
 * Deletes an OFFICIAL template on Meta's side by name (Meta has no delete-by-id endpoint for
 * templates -- name is the only key it accepts here, and deleting by name removes every
 * language variant of that name at once). Without this, a template removed from wa-inbox's own
 * database keeps existing -- and keeps being sendable -- on Meta, and its name stays reserved
 * for 30 days (Meta will reject a same-named resubmission with no obvious reason why).
 */
export async function deleteMetaTemplate(waNumber: { wabaId: string; accessToken: string }, name: string): Promise<void> {
  await metaFetch(`/${waNumber.wabaId}/message_templates?name=${encodeURIComponent(name)}`, waNumber.accessToken, {
    method: 'DELETE',
  })
}

export type LibraryTemplateButton = { type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER' | 'COPY_CODE'; text: string; url?: string }
export type LibraryTemplate = {
  id: string
  name: string
  category: string
  language: string
  header: string | null
  body: string
  buttons: LibraryTemplateButton[]
}

/**
 * Meta's pre-built, pre-vetted template library (`GET /message_template_library`) -- a global,
 * account-independent catalog (no WABA id in the path), so any of this app's Meta-linked
 * access tokens can read it. Starting a new OFFICIAL template from one of these is faster to
 * get approved than free-authored text, since Meta already reviewed the pattern itself.
 */
export async function getTemplateLibrary(
  accessToken: string,
  filters: { category?: string; language?: string; nameOrContent?: string; after?: string; limit?: number } = {}
): Promise<{ templates: LibraryTemplate[]; nextCursor: string | null }> {
  const params = new URLSearchParams()
  if (filters.category) params.set('category', filters.category)
  if (filters.language) params.set('language', filters.language)
  if (filters.nameOrContent) params.set('name_or_content', filters.nameOrContent)
  if (filters.after) params.set('after', filters.after)
  params.set('limit', String(filters.limit ?? 25))

  const body = await metaFetch(`/message_template_library?${params.toString()}`, accessToken)
  const templates: LibraryTemplate[] = (body.data ?? []).map((t: Record<string, unknown>) => ({
    id: t.id,
    name: t.name,
    category: t.category,
    language: t.language,
    header: (t.header as string | undefined) ?? null,
    body: t.body,
    buttons: (t.buttons as LibraryTemplateButton[] | undefined) ?? [],
  }))
  return { templates, nextCursor: body.paging?.cursors?.after ?? null }
}

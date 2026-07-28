import { metaFetch } from './client'
import { uploadMetaResumable } from './media-upload'
import type { CarouselCardDef, CarouselButtonDef } from './carousel-types'

export async function submitMetaTemplate(
  waNumber: { wabaId: string; accessToken: string },
  template: { name: string; category: string; body: string; variables: string[] }
): Promise<{ metaId: string; status: string }> {
  const body = await metaFetch(`/${waNumber.wabaId}/message_templates`, waNumber.accessToken, {
    method: 'POST',
    body: JSON.stringify({
      name: template.name,
      language: 'id',
      category: template.category,
      components: [{ type: 'BODY', text: template.body }],
    }),
  })
  return { metaId: body.id, status: body.status }
}

function buildCardButtonComponents(buttons: CarouselCardDef['buttons']) {
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
    ...buildCardButtonComponents(template.buttons),
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
  template: { name: string; category: string; body: string; buttonText: string; exampleCode: string }
): Promise<{ metaId: string; status: string }> {
  const components = [
    { type: 'BODY', text: template.body },
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
          ...buildCardButtonComponents(card.buttons),
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

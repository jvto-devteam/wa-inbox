import { metaFetch } from './client'
import type { CarouselButtonDef } from './carousel-types'

export async function sendMetaText(
  waNumber: { phoneNumberId: string; accessToken: string },
  to: string,
  text: string,
  replyToExternalId?: string
): Promise<{ externalId: string }> {
  const body = await metaFetch(`/${waNumber.phoneNumberId}/messages`, waNumber.accessToken, {
    method: 'POST',
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text },
      ...(replyToExternalId ? { context: { message_id: replyToExternalId } } : {}),
    }),
  })
  return { externalId: body.messages[0].id }
}

type MetaMediaType = 'image' | 'video' | 'audio' | 'document'

/**
 * Sends an already-uploaded media message (see uploadMetaMediaFromUrl for the upload step
 * that produces `mediaId`). Audio never carries a caption on Meta's API -- passing one there
 * is silently ignored by Meta, so it's dropped here rather than sent for nothing.
 */
export async function sendMetaMedia(
  waNumber: { phoneNumberId: string; accessToken: string },
  to: string,
  mediaType: MetaMediaType,
  mediaId: string,
  caption?: string,
  replyToExternalId?: string
): Promise<{ externalId: string }> {
  const mediaObject: Record<string, unknown> = { id: mediaId }
  if (caption && mediaType !== 'audio') mediaObject.caption = caption

  const body = await metaFetch(`/${waNumber.phoneNumberId}/messages`, waNumber.accessToken, {
    method: 'POST',
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: mediaType,
      [mediaType]: mediaObject,
      ...(replyToExternalId ? { context: { message_id: replyToExternalId } } : {}),
    }),
  })
  return { externalId: body.messages[0].id }
}

type TemplateCardToSend = { mediaId: string; mediaType: 'IMAGE' | 'VIDEO'; buttons: CarouselButtonDef[] }

/**
 * Dispatches a real Cloud API template message (type: 'template') -- the actual send path a
 * Meta-approved template needs, as opposed to ComposeBox's quick-reply shortcut (which just
 * pastes a QUICK_REPLY template's text into a plain-text send). `cards` carries fresh
 * per-send media ids (see uploadMetaMediaFromUrl); only quick-reply buttons need a runtime
 * parameter -- this app's URL/phone-number buttons are always static, so Meta already has
 * everything it needs for those from the template definition itself.
 */
export async function sendTemplateMessage(
  waNumber: { phoneNumberId: string; accessToken: string },
  to: string,
  template: {
    name: string
    bodyParams: string[]
    cards?: TemplateCardToSend[]
    // LTO: the real, per-send expiration for the countdown banner -- submission time only
    // ever recorded `has_expiration: true` (see submitLtoTemplate), Meta requires the actual
    // timestamp fresh on every send.
    limitedTimeOfferExpirationMs?: number
    // COUPON: the real, live code this customer actually receives -- never the placeholder
    // `example` value the template was submitted with (see submitCouponTemplate).
    couponCode?: string
  }
): Promise<{ externalId: string }> {
  const components: unknown[] = []
  if (template.bodyParams.length > 0) {
    components.push({ type: 'body', parameters: template.bodyParams.map((text) => ({ type: 'text', text })) })
  }
  if (template.limitedTimeOfferExpirationMs != null) {
    components.push({
      type: 'limited_time_offer',
      parameters: [
        { type: 'limited_time_offer', limited_time_offer: { expiration_time_ms: template.limitedTimeOfferExpirationMs } },
      ],
    })
  }
  if (template.couponCode) {
    // index '0': a coupon template has exactly one BUTTONS component with exactly one
    // button (see submitCouponTemplate) -- there is no second button whose index this could
    // ever need to disambiguate from.
    components.push({
      type: 'button',
      sub_type: 'copy_code',
      index: '0',
      parameters: [{ type: 'coupon_code', coupon_code: template.couponCode }],
    })
  }
  if (template.cards && template.cards.length > 0) {
    components.push({
      type: 'carousel',
      cards: template.cards.map((card, cardIndex) => {
        const mediaKey = card.mediaType.toLowerCase()
        const cardComponents: unknown[] = [
          { type: 'header', parameters: [{ type: mediaKey, [mediaKey]: { id: card.mediaId } }] },
        ]
        card.buttons.forEach((b, i) => {
          if (b.type === 'QUICK_REPLY') {
            cardComponents.push({
              type: 'button',
              sub_type: 'quick_reply',
              index: i,
              parameters: [{ type: 'payload', payload: b.text }],
            })
          }
        })
        return { card_index: cardIndex, components: cardComponents }
      }),
    })
  }

  const body = await metaFetch(`/${waNumber.phoneNumberId}/messages`, waNumber.accessToken, {
    method: 'POST',
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: { name: template.name, language: { code: 'id' }, components },
    }),
  })
  return { externalId: body.messages[0].id }
}

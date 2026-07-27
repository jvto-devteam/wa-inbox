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
  template: { name: string; bodyParams: string[]; cards?: TemplateCardToSend[] }
): Promise<{ externalId: string }> {
  const components: unknown[] = []
  if (template.bodyParams.length > 0) {
    components.push({ type: 'body', parameters: template.bodyParams.map((text) => ({ type: 'text', text })) })
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

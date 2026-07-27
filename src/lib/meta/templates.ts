import { metaFetch } from './client'
import { uploadMetaResumable } from './media-upload'
import type { CarouselCardDef } from './carousel-types'

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

import { metaFetch } from './client'

export async function sendMetaText(
  waNumber: { phoneNumberId: string; accessToken: string },
  to: string,
  text: string
): Promise<{ externalId: string }> {
  const body = await metaFetch(`/${waNumber.phoneNumberId}/messages`, waNumber.accessToken, {
    method: 'POST',
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } }),
  })
  return { externalId: body.messages[0].id }
}

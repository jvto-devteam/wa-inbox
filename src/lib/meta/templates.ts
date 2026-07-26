import { metaFetch } from './client'

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

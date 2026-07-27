const GRAPH_BASE = 'https://graph.facebook.com/v20.0'

async function downloadSource(sourceUrl: string): Promise<{ bytes: ArrayBuffer; mimeType: string }> {
  const res = await fetch(sourceUrl)
  if (!res.ok) throw new Error(`Gagal mengunduh media dari ${sourceUrl}`)
  const mimeType = res.headers.get('content-type') ?? 'application/octet-stream'
  return { bytes: await res.arrayBuffer(), mimeType }
}

/**
 * Downloads media from a source URL (whatever the admin/agent supplied when authoring a
 * carousel card) and uploads it to Meta's regular Media API, returning a media id usable
 * directly in an outbound message's header parameter. This is the SEND-time path -- the
 * returned id belongs to this WABA's phone number and is meant to be used right away, unlike
 * the Resumable Upload API's handle (see uploadMetaResumable), which is only for template
 * *creation* and expires long before a real send would need it.
 */
export async function uploadMetaMediaFromUrl(
  waNumber: { phoneNumberId: string; accessToken: string },
  sourceUrl: string
): Promise<{ id: string; mimeType: string }> {
  const { bytes, mimeType } = await downloadSource(sourceUrl)

  const form = new FormData()
  form.append('messaging_product', 'whatsapp')
  form.append('type', mimeType)
  form.append('file', new Blob([bytes], { type: mimeType }), 'upload')

  const res = await fetch(`${GRAPH_BASE}/${waNumber.phoneNumberId}/media`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${waNumber.accessToken}` },
    body: form,
  })
  const body = await res.json()
  if (!res.ok) throw new Error(body.error?.message ?? 'Gagal mengunggah media ke Meta')
  return { id: body.id, mimeType }
}

/**
 * Meta's Resumable Upload API (two steps: open a session, then push the bytes), used only
 * when SUBMITTING a template for approval -- the CAROUSEL card HEADER component's
 * `example.header_handle`. The returned handle is short-lived (create the template within
 * ~24h) and must never be reused to actually send a message; see uploadMetaMediaFromUrl for
 * that.
 */
export async function uploadMetaResumable(
  appId: string,
  accessToken: string,
  sourceUrl: string
): Promise<{ handle: string }> {
  const { bytes, mimeType } = await downloadSource(sourceUrl)

  const startRes = await fetch(
    `${GRAPH_BASE}/${appId}/uploads?file_length=${bytes.byteLength}&file_type=${encodeURIComponent(mimeType)}&access_token=${accessToken}`,
    { method: 'POST' }
  )
  const startBody = await startRes.json()
  if (!startRes.ok) throw new Error(startBody.error?.message ?? 'Gagal memulai upload media ke Meta')
  const uploadSessionId = startBody.id as string

  const uploadRes = await fetch(`${GRAPH_BASE}/${uploadSessionId}`, {
    method: 'POST',
    headers: { Authorization: `OAuth ${accessToken}`, file_offset: '0' },
    body: bytes,
  })
  const uploadBody = await uploadRes.json()
  if (!uploadRes.ok) throw new Error(uploadBody.error?.message ?? 'Gagal mengunggah media ke Meta')
  return { handle: uploadBody.h as string }
}

import { metaFetch } from './client'

/**
 * Resolves a Meta media id (from an inbound image/audio/video/document/sticker
 * message) to a short-lived, authenticated download URL. The URL itself expires
 * in minutes, so callers must fetch it and stream/consume the bytes immediately
 * rather than persisting the URL.
 */
export async function resolveMetaMediaUrl(mediaId: string, accessToken: string): Promise<{ url: string; mimeType: string }> {
  const body = await metaFetch(`/${mediaId}`, accessToken)
  return { url: body.url, mimeType: body.mime_type }
}

/**
 * Downloads the media bytes themselves. This is a plain authenticated GET, not
 * `metaFetch` -- the response body is binary (image/audio/video/pdf), not JSON.
 */
export async function downloadMetaMedia(url: string, accessToken: string): Promise<Response> {
  return fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
}

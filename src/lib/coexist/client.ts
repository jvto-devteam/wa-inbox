type CoexistCreds = { coexistBaseUrl: string; coexistApiKey: string; coexistNumberKey: string }

type CoexistResponse = {
  // wa-coexist's WatZap-compatible v1 API signals success with the string
  // "200" (not a boolean or "success") and errors with codes like "1002"-"1006".
  // See wa-coexist's src/routes/v1.js.
  status: string
  message?: string
  ack?: string
  [key: string]: unknown
}

// The Unofficial channel now points at wa-dashboard's v1 API (the same
// WatZap-compatible contract wa-coexist was originally ported from) instead
// of the retired wa-coexist service. wa-dashboard has no equivalent of
// wa-coexist's unauthenticated /api/status and /api/relink admin routes —
// its own connect/status endpoints require a session-cookie admin login on
// wa-dashboard's own domain, not something callable with api_key/number_key
// creds from another service. Deliberately scoped down to send-only
// (getCoexistStatus/relinkCoexist removed) rather than building new
// integration surface wa-dashboard doesn't offer.
//
// A send timeout must sit above however long the target service's own
// "wait for connected" grace period is (observed up to ~15s on wa-coexist),
// or we'd abort a legitimately-slow-but-successful send. Sends still need
// *some* bound: sendCoexistText is on the bot-reply path (src/lib/send.ts,
// called from the Meta inbound webhook), so an unbounded hang there stalls
// the webhook response past Meta's window.
const SEND_TIMEOUT_MS = 20000

async function coexistPost(creds: CoexistCreds, path: string, body: Record<string, unknown>): Promise<CoexistResponse> {
  const res = await fetch(`${creds.coexistBaseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: creds.coexistApiKey, number_key: creds.coexistNumberKey, ...body }),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  })
  const json = (await res.json()) as CoexistResponse
  if (!res.ok || json.status !== '200') throw new Error(json.message ?? 'wa-coexist send failed')
  return json
}

// wa-coexist's /api/v1/* send endpoints never return a message ID in their
// response body (only status/message/ack), so externalId is always
// undefined here. Kept optional in the return type for parity with the
// Official Graph API client (see src/lib/meta/messages.ts), whose response
// does carry one.
export async function sendCoexistText(creds: CoexistCreds, to: string, text: string): Promise<{ externalId?: string }> {
  await coexistPost(creds, '/api/v1/send_message', { phone_no: to, message: text })
  return {}
}

export async function sendCoexistMedia(
  creds: CoexistCreds,
  to: string,
  mediaUrl: string,
  type: 'image' | 'video' | 'document',
  caption?: string
): Promise<{ externalId?: string }> {
  if (type === 'image') {
    // wa-coexist's /api/v1/send_image_url takes the caption in a field
    // named `message`, not `caption`.
    await coexistPost(creds, '/api/v1/send_image_url', { phone_no: to, url: mediaUrl, message: caption })
  } else {
    // wa-coexist's /api/v1/send_file_url has no caption/message field at
    // all (only phone_no, url, and an optional filename) — video/document
    // sends via this WatZap-compatible API cannot carry a caption, so it's
    // dropped here rather than mis-sent as a filename.
    await coexistPost(creds, '/api/v1/send_file_url', { phone_no: to, url: mediaUrl })
  }
  return {}
}

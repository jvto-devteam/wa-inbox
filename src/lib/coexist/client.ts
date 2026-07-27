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

// Timeouts differ per call because the work behind each endpoint differs.
// wa-coexist's own `ensureConnected` can block up to 15s before a send
// endpoint responds, so a send timeout must sit ABOVE that (20s) or we'd
// abort legitimately-slow-but-successful sends before wa-coexist even
// finishes its own wait. Sends still need *some* bound: sendCoexistText is on
// the bot-reply path (src/lib/send.ts, called from the Meta inbound webhook),
// so an unbounded hang there stalls the webhook response past Meta's window.
const SEND_TIMEOUT_MS = 20000
// /api/status is a lightweight in-memory probe with no connection wait — if
// it hasn't answered in 5s wa-coexist is effectively down, and the Settings
// page is blocked on this.
const STATUS_TIMEOUT_MS = 5000
// /api/relink is admin-triggered with a human waiting on the response: long
// enough to cover a real re-pair round trip, short enough to fail visibly
// rather than leave the button spinning indefinitely.
const RELINK_TIMEOUT_MS = 10000

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

export async function getCoexistStatus(creds: CoexistCreds): Promise<{ connected: boolean }> {
  try {
    const res = await fetch(`${creds.coexistBaseUrl}/api/status`, {
      signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
    })
    if (!res.ok) return { connected: false }
    const json = (await res.json()) as { status: string; user?: unknown; qr?: unknown }
    return { connected: json.status === 'connected' }
  } catch {
    return { connected: false }
  }
}

export async function relinkCoexist(creds: CoexistCreds): Promise<void> {
  const res = await fetch(`${creds.coexistBaseUrl}/api/relink`, {
    method: 'POST',
    signal: AbortSignal.timeout(RELINK_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error('Relink failed')
}

const GRAPH_BASE = 'https://graph.facebook.com/v20.0'

export async function metaFetch(path: string, accessToken: string, init?: RequestInit) {
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', ...init?.headers },
  })
  const body = await res.json()
  if (!res.ok) throw new Error(body.error?.message ?? 'Meta Graph API error')
  return body
}

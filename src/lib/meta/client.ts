const GRAPH_BASE = 'https://graph.facebook.com/v20.0'

export async function metaFetch(path: string, accessToken: string, init?: RequestInit, graphVersion?: string) {
  const base = graphVersion ? `https://graph.facebook.com/${graphVersion}` : GRAPH_BASE
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', ...init?.headers },
  })
  const body = await res.json()
  if (!res.ok) throw new Error(body.error?.message ?? 'Meta Graph API error')
  return body
}

import { GmailError } from './errors'
import { refreshAccessToken } from './oauth'
import type { GmailHistoryPage, GmailMessage } from './types'

/**
 * Klien Gmail API v1, fetch langsung -- pola yang sama dengan modul Meta (src/lib/meta/*).
 * Tidak ada SDK: permukaan yang dipakai hanya tujuh endpoint, dan fetch yang di-mock lebih
 * jujur diuji daripada SDK yang di-mock.
 */
const API = 'https://gmail.googleapis.com/gmail/v1/users/me'

/** Access token Google berumur ~1 jam. Satu per kotak surat, di memori proses ini saja. */
const tokenCache = new Map<string, { token: string; expiresAt: number }>()

export async function getAccessToken(account: { id: string; refreshToken: string }, nowMs: number = Date.now()): Promise<string> {
  const cached = tokenCache.get(account.id)
  if (cached && cached.expiresAt - 60_000 > nowMs) return cached.token
  const fresh = await refreshAccessToken(account.refreshToken)
  tokenCache.set(account.id, { token: fresh.accessToken, expiresAt: nowMs + fresh.expiresInSec * 1000 })
  return fresh.accessToken
}

export function invalidateAccessToken(accountId: string): void {
  tokenCache.delete(accountId)
}

export function __resetTokenCacheForTests(): void {
  tokenCache.clear()
}

async function errorFrom(res: Response): Promise<GmailError> {
  const json = (await res.json().catch(() => ({}))) as { error?: { status?: string } }
  const googleStatus = json.error?.status ?? ''
  const message = `Gmail API ${res.status} ${googleStatus}`.trim()
  if (res.status === 401) return new GmailError('UNAUTHORIZED', message, res.status)
  if (res.status === 404) return new GmailError('NOT_FOUND', message, res.status)
  return new GmailError('HTTP', message, res.status)
}

async function gmailFetch<T>(token: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  if (!res.ok) throw await errorFrom(res)
  return (await res.json()) as T
}

export function gmailGetProfile(token: string): Promise<{ emailAddress: string; historyId: string }> {
  return gmailFetch(token, '/profile')
}

/**
 * Pasang atau perpanjang push. Nama field `labelFilterBehavior` dan nilai enumnya diverifikasi
 * terhadap dokumentasi users.watch saat Tugas 2 (HTML mentah developers.google.com, bukan brief):
 * field-nya bertipe `enum (LabelFilterAction)` dengan nilai huruf kecil `include`/`exclude` --
 * BUKAN `INCLUDE` seperti draf awal. Kalau Google mengubahnya lagi, test ikut berubah.
 */
export function gmailWatch(token: string, topicName: string): Promise<{ historyId: string; expiration: string }> {
  return gmailFetch(token, '/watch', { topicName, labelIds: ['INBOX', 'SENT'], labelFilterBehavior: 'include' })
}

export async function gmailListHistory(token: string, startHistoryId: string, pageToken?: string): Promise<GmailHistoryPage> {
  const params = new URLSearchParams({ startHistoryId, historyTypes: 'messageAdded' })
  if (pageToken) params.set('pageToken', pageToken)
  try {
    return await gmailFetch<GmailHistoryPage>(token, `/history?${params.toString()}`)
  } catch (error) {
    // Gmail menjawab 404 kalau startHistoryId sudah terlalu tua untuk disimpannya. Itu bukan
    // "tidak ditemukan" biasa -- pemanggil harus memulihkan kursor (src/lib/gmail/sync.ts).
    if (error instanceof GmailError && error.kind === 'NOT_FOUND') {
      throw new GmailError('HISTORY_EXPIRED', 'Kursor history Gmail kedaluwarsa', 404)
    }
    throw error
  }
}

export async function gmailListMessageIds(token: string, query: string): Promise<string[]> {
  const ids: string[] = []
  let pageToken: string | undefined
  do {
    const params = new URLSearchParams({ q: query })
    if (pageToken) params.set('pageToken', pageToken)
    const page = await gmailFetch<{ messages?: Array<{ id: string }>; nextPageToken?: string }>(token, `/messages?${params.toString()}`)
    for (const m of page.messages ?? []) ids.push(m.id)
    pageToken = page.nextPageToken
  } while (pageToken)
  return ids
}

/** Null kalau email sudah dihapus di antara history.list dan pengambilan ini. */
export async function gmailGetMessage(token: string, id: string): Promise<GmailMessage | null> {
  try {
    return await gmailFetch<GmailMessage>(token, `/messages/${encodeURIComponent(id)}?format=full`)
  } catch (error) {
    if (error instanceof GmailError && error.kind === 'NOT_FOUND') return null
    throw error
  }
}

/** Kunci hasil SELALU huruf kecil: pengirim menulis `Message-Id` maupun `Message-ID`. */
export async function gmailGetMessageHeaders(token: string, id: string, names: string[]): Promise<Record<string, string>> {
  const params = new URLSearchParams({ format: 'metadata' })
  for (const name of names) params.append('metadataHeaders', name)
  const message = await gmailFetch<GmailMessage>(token, `/messages/${encodeURIComponent(id)}?${params.toString()}`)
  const result: Record<string, string> = {}
  for (const h of message.payload?.headers ?? []) result[h.name.toLowerCase()] = h.value
  return result
}

export function gmailSendRaw(token: string, raw: string, threadId: string): Promise<{ id: string; threadId: string }> {
  return gmailFetch(token, '/messages/send', { raw, threadId })
}

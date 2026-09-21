/**
 * API keys for the other programs that send system templates (ApiClient in prisma/schema.prisma).
 *
 * Sibling of src/lib/outbound/cron-auth.ts, with one difference that matters: there is one key
 * PER calling program (javavolcano-touroperator, new-backoffice), not one shared env secret, so
 * a leaked key can be revoked without breaking the other program, and every job records which
 * program asked for it.
 *
 * Only the SHA-256 of a key is stored. A lookup by hash leaks nothing useful through timing —
 * an attacker would have to produce a preimage of a hash they cannot see — so no constant-time
 * comparison is needed on top of it. The raw key exists in exactly one response: the one that
 * created it (CLAUDE.md §5).
 */
import { createHash, randomBytes } from 'node:crypto'
import { prisma } from '@/lib/db'

/** Makes a key recognisable on sight in a Laravel .env or a leaked log. */
export const API_KEY_PREFIX = 'wai_'
const PREFIX_SHOWN = 12

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex')
}

export function generateApiKey(): { key: string; keyHash: string; keyPrefix: string } {
  const key = `${API_KEY_PREFIX}${randomBytes(32).toString('base64url')}`
  return { key, keyHash: hashApiKey(key), keyPrefix: key.slice(0, PREFIX_SHOWN) }
}

/** The bearer token of a request, if it is shaped like one of our keys. */
export function bearerApiKey(req: Request): string | null {
  const header = req.headers.get('authorization')
  const match = header?.match(/^Bearer\s+(\S+)$/i)
  const key = match?.[1]
  return key && key.startsWith(API_KEY_PREFIX) ? key : null
}

export type AuthenticatedClient = { id: string; name: string }

export async function authenticateApiClient(req: Request): Promise<AuthenticatedClient | null> {
  const key = bearerApiKey(req)
  if (!key) return null

  const client = await prisma.apiClient.findUnique({
    where: { keyHash: hashApiKey(key) },
    select: { id: true, name: true, revokedAt: true },
  })
  if (!client || client.revokedAt) return null

  // Best effort: a failed timestamp write must not turn a valid key into a rejected request.
  void prisma.apiClient
    .update({ where: { id: client.id }, data: { lastUsedAt: new Date() } })
    .catch((error: unknown) => console.error('api-clients: gagal mencatat lastUsedAt', { clientId: client.id, error }))

  return { id: client.id, name: client.name }
}

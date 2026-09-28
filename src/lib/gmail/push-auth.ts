import { timingSafeEqual } from 'node:crypto'
import { MIN_SECRET_LENGTH } from '@/lib/outbound/cron-auth'

/**
 * Token rahasia di query string langganan push Pub/Sub (keputusan D6).
 *
 * Cukup karena push hanya bel pintu: isinya tidak dipercaya untuk apa pun -- email selalu
 * diambil ulang dari Gmail dengan kredensial kita. Push palsu paling jauh memicu satu
 * sinkronisasi ekstra. Sifat keamanannya sama dengan cron-auth.ts: env kosong/pendek berarti
 * SELALU tolak, perbandingan timing-safe.
 */
export const GMAIL_PUSH_TOKEN_ENV = 'GMAIL_PUSH_TOKEN'

export function hasValidPushToken(url: URL): boolean {
  const expected = process.env[GMAIL_PUSH_TOKEN_ENV]
  if (!expected || expected.length < MIN_SECRET_LENGTH) return false
  const provided = url.searchParams.get('token')
  if (!provided) return false
  const a = Buffer.from(provided, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

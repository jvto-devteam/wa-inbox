import crypto from 'crypto'

/**
 * One app's HMAC secret, or an absent one. A caller building the list from env vars
 * (e.g. `process.env.FB_APP_SECRET`, which may be unset) should be able to pass the
 * raw value through without having to filter first — this function fails closed on
 * anything that isn't a non-empty string.
 */
type MetaAppSecret = string | null | undefined

/**
 * Accepts either a single secret (the original call shape, kept for backward
 * compatibility) or a list of secrets — one endpoint can then serve multiple Meta
 * apps, each with its own signing secret, and a signature matching ANY of them
 * verifies.
 */
export type MetaAppSecretInput = MetaAppSecret | ReadonlyArray<MetaAppSecret>

export function verifyMetaSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecrets: MetaAppSecretInput,
): boolean {
  if (!signatureHeader?.startsWith('sha256=')) return false
  const provided = signatureHeader.slice('sha256='.length)

  // Validate the SHAPE of `provided` up front, not just its string length. A SHA-256
  // hex digest is always exactly 64 lowercase/uppercase hex characters. Comparing only
  // `.length` (UTF-16 code units) against `expected.length` lets a crafted header like
  // 63 ASCII hex chars + 1 non-ASCII character through (`provided.length === 64`), but
  // `Buffer.from(provided)` then encodes to 65 UTF-8 bytes — and `crypto.timingSafeEqual`
  // throws a RangeError on mismatched *byte* lengths instead of returning false. Since
  // `provided` is attacker-controlled, that throw is reachable from the network. Rejecting
  // anything outside this shape here guarantees every buffer built from `provided` below
  // is exactly 64 bytes, so `timingSafeEqual` can never throw.
  if (!/^[0-9a-f]{64}$/i.test(provided)) return false

  const secretList = Array.isArray(appSecrets) ? appSecrets : [appSecrets]
  const validSecrets = secretList.filter((s): s is string => typeof s === 'string' && s.length > 0)

  // Fail closed: no usable secret configured means no signature can ever verify.
  if (validSecrets.length === 0) return false

  for (const secret of validSecrets) {
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
    // No length guard needed here: `expected` is always a 64-char hex digest, and
    // `provided` was validated to that exact shape above, so both buffers passed to
    // timingSafeEqual are always 64 bytes.
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided))) {
      return true
    }
  }
  return false
}

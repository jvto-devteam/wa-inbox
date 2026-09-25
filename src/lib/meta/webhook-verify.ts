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

  const secretList = Array.isArray(appSecrets) ? appSecrets : [appSecrets]
  const validSecrets = secretList.filter((s): s is string => typeof s === 'string' && s.length > 0)

  // Fail closed: no usable secret configured means no signature can ever verify.
  if (validSecrets.length === 0) return false

  for (const secret of validSecrets) {
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
    if (expected.length !== provided.length) continue
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided))) {
      return true
    }
  }
  return false
}

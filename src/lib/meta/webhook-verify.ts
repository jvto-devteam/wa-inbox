import crypto from 'crypto'

export function verifyMetaSignature(rawBody: string, signatureHeader: string | null, appSecret: string): boolean {
  if (!signatureHeader?.startsWith('sha256=')) return false
  const expected = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')
  const provided = signatureHeader.slice('sha256='.length)
  if (expected.length !== provided.length) return false
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided))
}

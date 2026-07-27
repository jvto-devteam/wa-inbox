import { SignJWT, jwtVerify } from 'jose'

// `tokenVersion` mirrors Account.tokenVersion at the moment the token was
// minted. It is what makes these otherwise-stateless JWTs revocable: bumping
// the column (password reset, role change) instantly invalidates every token
// already in the wild. The comparison itself happens in src/middleware.ts,
// which is the one place every request passes through.
export type SessionPayload = { accountId: string; role: 'ADMIN' | 'AGENT'; tokenVersion: number }

function secretKey() {
  const secret = process.env.SESSION_SECRET
  if (!secret) {
    throw new Error('SESSION_SECRET environment variable is not set')
  }
  return new TextEncoder().encode(secret)
}

export async function createSessionCookie(payload: SessionPayload): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(secretKey())
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey())
    // Tokens minted before tokenVersion existed carry no version claim, so
    // there is nothing to compare against the account's current value.
    // Reject them outright rather than defaulting to 0 — defaulting would
    // let a pre-upgrade token slip past the revocation check on any account
    // that has never had its tokenVersion bumped. The holder just logs in again.
    if (typeof payload.tokenVersion !== 'number') return null
    return {
      accountId: payload.accountId as string,
      role: payload.role as 'ADMIN' | 'AGENT',
      tokenVersion: payload.tokenVersion,
    }
  } catch {
    return null
  }
}

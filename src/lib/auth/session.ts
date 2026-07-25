import { SignJWT, jwtVerify } from 'jose'

export type SessionPayload = { accountId: string; role: 'ADMIN' | 'AGENT' }

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
    return { accountId: payload.accountId as string, role: payload.role as 'ADMIN' | 'AGENT' }
  } catch {
    return null
  }
}

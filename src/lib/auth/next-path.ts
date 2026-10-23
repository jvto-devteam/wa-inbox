/**
 * Kembali ke halaman semula sesudah masuk (owner 2026-10-23: membuka /ai-office tanpa sesi lalu login malah mendarat di
 * /dashboard). Middleware dan `redirectToLogin` menitipkan jalur asal sebagai `/login?next=...`; layar masuk membacanya
 * lewat `safeNextPath`.
 *
 * `next` datang dari URL, jadi bisa ditulis siapa saja: hanya jalur INTERNAL yang diterima. "//evil.com" dan "/\evil.com"
 * ditafsirkan browser sebagai alamat situs lain (open redirect), jadi ditolak; begitu juga /login (putaran) dan /api/*
 * (bukan halaman).
 */
export const DEFAULT_AFTER_LOGIN = '/dashboard'
const MAX_NEXT_LENGTH = 512

export function safeNextPath(raw: string | null | undefined): string {
  if (!raw || raw.length > MAX_NEXT_LENGTH) return DEFAULT_AFTER_LOGIN
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return DEFAULT_AFTER_LOGIN
  if (/[\u0000-\u001f]/.test(raw)) return DEFAULT_AFTER_LOGIN
  const path = raw.split(/[?#]/)[0]
  if (path === '/login' || path.startsWith('/login/') || path.startsWith('/api/')) return DEFAULT_AFTER_LOGIN
  return raw
}

/** Alamat layar masuk yang membawa jalur asal. Beranda/dasbor tidak perlu dititipkan. */
export function loginPathFor(pathname: string, search = ''): string {
  if (pathname === '/' || pathname === DEFAULT_AFTER_LOGIN || pathname === '/login') return '/login'
  const target = `${pathname}${search}`
  return safeNextPath(target) === target ? `/login?next=${encodeURIComponent(target)}` : '/login'
}

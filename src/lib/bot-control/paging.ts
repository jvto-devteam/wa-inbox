/**
 * Shared paging reader for the Bot Control list endpoints.
 *
 * The clamp is the point. `?limit=100000` on a table that will hold thousands of chunks is an
 * accidental denial of service against the app's own database, and `?page=-1` produces a
 * negative `skip` that Prisma rejects at runtime with a 500 rather than an empty page.
 */
export const DEFAULT_LIMIT = 50
export const MAX_LIMIT = 200

export function readPaging(url: URL): { page: number; limit: number; skip: number } {
  // `Number('abc')` is NaN and `NaN || DEFAULT` falls through to the default, which is the
  // behaviour we want for junk input: serve page 1 rather than 400 on a malformed query string.
  const page = Math.max(1, Math.floor(Number(url.searchParams.get('page')) || 1))
  const rawLimit = Math.floor(Number(url.searchParams.get('limit')) || DEFAULT_LIMIT)
  const limit = Math.min(MAX_LIMIT, Math.max(1, rawLimit))
  return { page, limit, skip: (page - 1) * limit }
}

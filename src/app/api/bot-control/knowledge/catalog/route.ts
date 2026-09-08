import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/get-session'
import { readPaging } from '@/lib/bot-control/paging'
import { searchCatalogEntries, catalogTopics } from '@/lib/bot-control/catalog-explorer'

/**
 * GET /api/bot-control/knowledge/catalog — the contents of `catalog/*.json`, searchable.
 *
 * Read-only for any signed-in user (guidebook §19: AGENT read-only across Bot Control).
 *
 * There is no POST. This endpoint replaced a pair that read a database mirror of the catalog
 * and rebuilt it on demand; the mirror was never read by the bot, so re-indexing existed only
 * to keep a copy honest. Reading disk directly means there is nothing to keep honest — and no
 * write path near `KnowledgeSource` that could touch an operator's `MANUAL` rows.
 *
 * The route exists at all (rather than the page reading disk in a server component) because
 * the Knowledge Explorer is a client component: it holds editor, revision and search state
 * that would otherwise all have to round-trip through the URL. One fetch is the smaller change.
 *
 * Filesystem access forces the Node runtime; the default would let Next pick edge, where
 * `fs` does not exist.
 */
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 })

  const url = new URL(req.url)
  const { page, limit, skip } = readPaging(url)

  try {
    const result = searchCatalogEntries({
      q: url.searchParams.get('q'),
      topic: url.searchParams.get('topic'),
      page,
      limit,
      skip,
    })
    return NextResponse.json({ ...result, topics: catalogTopics() })
  } catch (error) {
    // A missing or unreadable `catalog/` is a deployment problem, not an empty catalog, and
    // rendering it as "no results" would have an operator conclude the bot knows nothing.
    console.error('GET /api/bot-control/knowledge/catalog gagal', error)
    return NextResponse.json({ error: 'Gagal membaca isi katalog dari disk' }, { status: 500 })
  }
}

import { NextResponse } from 'next/server'
import { loadCatalog } from '@/lib/bot/catalog'

// Read-only, open to every authenticated user (same as GET /api/templates) -- unlike
// sync-catalog's POST, this never touches the filesystem/child processes, it only reads
// whatever loadCatalog() already parses from the synced JSON on disk. Exists so an admin can
// actually see what the bot currently knows, not just when it was last synced.
export async function GET() {
  const catalog = loadCatalog()
  return NextResponse.json({
    syncedAt: catalog.syncedAt,
    packageCount: catalog.packages.length,
    packages: catalog.packages.map((p) => ({
      packageKey: p.packageKey,
      title: p.title,
      destinationTokens: p.destinationTokens,
      priceIdr: p.priceIdr,
    })),
  })
}

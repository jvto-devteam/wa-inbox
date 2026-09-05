import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/require-admin'
import { indexCatalogKnowledge } from '@/lib/bot-control/knowledge-indexer'

/**
 * POST /api/bot-control/knowledge/sync — re-index `catalog/*.json` into the explorer tables.
 *
 * NOT the same thing as POST /api/bot/sync-catalog, and the difference matters operationally:
 * that route shells out to `npm run sync:knowledge` and REWRITES the files the bot answers
 * from. This one only re-reads those files into KnowledgeSource/KnowledgeChunk so the explorer
 * matches disk. Running this can change nothing about what the bot says.
 *
 * Admin-only anyway (guidebook §19): it writes to the database and walks the filesystem, and
 * an AGENT hammering it would be a cheap way to load the server.
 */
export async function POST(req: Request) {
  const admin = await requireAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Hanya admin yang bisa menyinkronkan index knowledge' }, { status: 403 })

  try {
    const result = await indexCatalogKnowledge()
    // Per-file parse failures come back in `errors` and are reported as a successful run with
    // problems, not as a failed run: 31 indexed files plus one broken one is a materially
    // different situation from "nothing was indexed", and the operator needs to tell them apart.
    return NextResponse.json(result)
  } catch (error) {
    console.error('POST /api/bot-control/knowledge/sync gagal', error)
    return NextResponse.json({ error: 'Index knowledge gagal — cek log server' }, { status: 500 })
  }
}

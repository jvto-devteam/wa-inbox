import { requireAdmin } from '@/lib/auth/require-admin'
import { generateBotDocumentation } from '@/lib/bot-control/documentation-exporter'

/**
 * GET /api/bot-control/export-docs — the living documentation, as Markdown.
 *
 * Admin-only (guidebook §19 puts export alongside sync and simulate). The document aggregates
 * the whole bot configuration into one file that is meant to be handed to an owner, so who can
 * produce it is a real access decision, not a formality.
 *
 * Returns `text/markdown` per the contract (§20.9) rather than JSON, so the browser and any
 * `curl | less` treat it as the document it is. The error path deliberately stays JSON
 * `{ error }` — an error is not a document, and returning half a Markdown file with an
 * apology inside it would be indistinguishable from a real export to anything downstream.
 */
export async function GET(req: Request) {
  const admin = await requireAdmin(req)
  if (!admin) {
    return Response.json({ error: 'Hanya admin yang bisa mengekspor dokumentasi' }, { status: 403 })
  }

  try {
    const markdown = await generateBotDocumentation({ generatedAt: new Date() })
    return new Response(markdown, {
      status: 200,
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        // Names the file for a direct browser hit. The UI does its own client-side download so
        // it can offer a copy button too, but a plain GET should still save something sensible.
        'Content-Disposition': 'inline; filename="wa-inbox-bot-documentation.md"',
        // Never cached: the entire value of this document is that it reflects the system NOW.
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    console.error('GET /api/bot-control/export-docs gagal', error)
    return Response.json({ error: 'Gagal membuat dokumentasi' }, { status: 500 })
  }
}

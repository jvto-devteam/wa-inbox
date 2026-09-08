'use client'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'

/** Mirrors `CatalogEntry` in src/lib/bot-control/catalog-explorer.ts, over the wire. */
export type CatalogEntryRow = {
  id: string
  sourceFile: string
  topic: string
  title: string
  body: string
  links: string[]
  prices: number[]
  tags: string[]
}

const IDR = new Intl.NumberFormat('id-ID')

/** Long bodies collapse; the cut is on the client because the whole body is already here. */
const BODY_PREVIEW_LENGTH = 400

export function CatalogEntryPanel({
  entries,
  total,
  loading,
  error,
}: {
  entries: CatalogEntryRow[]
  total: number
  loading: boolean
  error: string | null
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  if (loading) return <p className="p-3 text-sm text-muted-foreground">Memuat isi katalog...</p>
  // A failure that renders as "no results" would have an operator conclude the bot knows
  // nothing about a topic when in fact the read never completed.
  if (error) return <p className="p-3 text-sm text-destructive">{error}</p>
  if (entries.length === 0) {
    return <p className="p-3 text-sm text-muted-foreground">Tidak ada isi katalog yang cocok.</p>
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Menampilkan {entries.length} dari {total} entri katalog.
      </p>

      {entries.map((entry) => {
        const expanded = expandedId === entry.id
        const truncated = entry.body.length > BODY_PREVIEW_LENGTH

        return (
          <Card key={entry.id} className="space-y-2 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="flex-1 text-sm font-medium text-navy">{entry.title}</p>
              <Badge variant="muted">{entry.topic}</Badge>
              {entry.links.length > 0 && <Badge variant="default">{entry.links.length} link</Badge>}
              {entry.prices.length > 0 && <Badge variant="default">{entry.prices.length} harga</Badge>}
            </div>

            {/* The file, not a database id: the way to change any of this is to edit the file. */}
            <p className="font-mono text-xs text-muted-foreground">catalog/{entry.sourceFile}</p>

            <p className="whitespace-pre-wrap text-sm text-foreground">
              {expanded || !truncated ? entry.body : entry.body.slice(0, BODY_PREVIEW_LENGTH)}
              {!expanded && truncated && '…'}
            </p>

            {truncated && (
              <button
                type="button"
                onClick={() => setExpandedId(expanded ? null : entry.id)}
                className="text-xs text-brand hover:underline"
              >
                {expanded ? 'Ringkas' : 'Tampilkan selengkapnya'}
              </button>
            )}

            {entry.prices.length > 0 && (
              <div className="text-xs">
                <span className="text-muted-foreground">Harga: </span>
                <span className="tabular-nums text-foreground">
                  {entry.prices.map((price) => `Rp ${IDR.format(price)}`).join(' · ')}
                </span>
              </div>
            )}

            {entry.links.length > 0 && (
              <div className="text-xs">
                <span className="text-muted-foreground">Link: </span>
                {/* Deliberately not anchors. These are grounding values the bot may cite, and a
                    relative path here is not a route in this app — rendering them as links
                    would send an operator to a 404 inside wa-inbox. */}
                <span className="font-mono break-all text-foreground">{entry.links.join(' · ')}</span>
              </div>
            )}

            {entry.tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {entry.tags.map((tag) => (
                  <Badge key={tag} variant="brand">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
          </Card>
        )
      })}
    </div>
  )
}

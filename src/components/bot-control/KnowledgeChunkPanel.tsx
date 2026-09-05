'use client'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'

export type KnowledgeChunkRow = {
  id: string
  sourceKey: string
  sourcePath: string | null
  topic: string | null
  title: string | null
  bodyPreview: string
  body: string
  links: unknown
  prices: unknown
  tags: unknown
  linksCount: number
  pricesCount: number
  hash: string
}

/** Json columns arrive as `unknown`; anything that is not an array of strings renders as nothing. */
function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function numberList(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is number => typeof item === 'number')
}

const IDR = new Intl.NumberFormat('id-ID')

export function KnowledgeChunkPanel({
  chunks,
  total,
  loading,
  error,
}: {
  chunks: KnowledgeChunkRow[]
  total: number
  loading: boolean
  error: string | null
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  if (loading) return <p className="p-3 text-sm text-muted-foreground">Memuat isi knowledge...</p>
  // A failure that renders as "no results" would have an operator conclude the bot knows
  // nothing about a topic when in fact the query never completed.
  if (error) return <p className="p-3 text-sm text-destructive">{error}</p>
  if (chunks.length === 0) {
    return <p className="p-3 text-sm text-muted-foreground">Tidak ada isi knowledge yang cocok.</p>
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Menampilkan {chunks.length} dari {total} chunk.
      </p>

      {chunks.map((chunk) => {
        const expanded = expandedId === chunk.id
        const links = stringList(chunk.links)
        const prices = numberList(chunk.prices)
        const tags = stringList(chunk.tags)

        return (
          <Card key={chunk.id} className="space-y-2 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="flex-1 text-sm font-medium text-navy">{chunk.title ?? '(tanpa judul)'}</p>
              {chunk.topic && <Badge variant="muted">{chunk.topic}</Badge>}
              <Badge variant="default">{chunk.linksCount} link</Badge>
              <Badge variant="default">{chunk.pricesCount} harga</Badge>
            </div>

            <p className="font-mono text-xs text-muted-foreground">{chunk.sourcePath ?? chunk.sourceKey}</p>

            <p className="whitespace-pre-wrap text-sm text-foreground">
              {expanded ? chunk.body : chunk.bodyPreview}
              {!expanded && chunk.body.length > chunk.bodyPreview.length && '…'}
            </p>

            {chunk.body.length > chunk.bodyPreview.length && (
              <button
                type="button"
                onClick={() => setExpandedId(expanded ? null : chunk.id)}
                className="text-xs text-brand hover:underline"
              >
                {expanded ? 'Ringkas' : 'Tampilkan selengkapnya'}
              </button>
            )}

            {prices.length > 0 && (
              <div className="text-xs">
                <span className="text-muted-foreground">Harga: </span>
                <span className="tabular-nums text-foreground">
                  {prices.map((price) => `Rp ${IDR.format(price)}`).join(' · ')}
                </span>
              </div>
            )}

            {links.length > 0 && (
              <div className="text-xs">
                <span className="text-muted-foreground">Link: </span>
                {/* Deliberately not anchors. These are grounding values the bot may cite, and a
                    relative path here is not a route in this app — rendering them as links
                    would send an operator to a 404 inside wa-inbox. */}
                <span className="font-mono break-all text-foreground">{links.join(' · ')}</span>
              </div>
            )}

            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {tags.map((tag) => (
                  <Badge key={tag} variant="brand">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}

            <p className="font-mono text-[10px] text-muted-foreground">{chunk.hash.slice(0, 12)}</p>
          </Card>
        )
      })}
    </div>
  )
}

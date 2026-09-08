'use client'
import { useState } from 'react'
import { FileSearch } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton, SkeletonText } from '@/components/ui/skeleton'

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

  if (loading) {
    return (
      <div className="divide-y divide-line border-y border-line" aria-hidden="true">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="space-y-2 py-3">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3 w-52" />
            <SkeletonText lines={2} />
          </div>
        ))}
      </div>
    )
  }
  // A failure that renders as "no results" would have an operator conclude the bot knows
  // nothing about a topic when in fact the read never completed.
  if (error) return <p className="text-base text-danger">{error}</p>
  if (entries.length === 0) {
    return (
      <EmptyState
        icon={<FileSearch strokeWidth={1.75} />}
        title="Tidak ada isi katalog yang cocok."
        description="Katalog dibaca langsung dari file. Longgarkan pencarian atau pilih topik lain — kalau file-nya memang belum berisi topik itu, di sinilah kekosongan itu terlihat."
        className="border-t border-line"
      />
    )
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-ink-muted tabular-nums">
        Menampilkan {entries.length} dari {total} entri katalog.
      </p>

      {/* Daftar berpembatas garis rambut, bukan tumpukan kartu: entri katalog adalah baris-baris
          sejenis, dan satu kotak per baris hanya menambah tinggi tanpa menambah arti. */}
      <ul className="divide-y divide-line border-y border-line">
        {entries.map((entry) => {
          const expanded = expandedId === entry.id
          const truncated = entry.body.length > BODY_PREVIEW_LENGTH

          return (
            // Dua kolom mulai xl: isi entri di kiri, keterangannya (file, harga, link, tag)
            // di kanan. Sebelumnya semuanya satu lajur, jadi begitu halaman ini memakai lebar
            // layar, badan teksnya melar sampai ~1400px — panjang baris yang tidak terbaca —
            // sementara barisan tag di bawahnya menyisakan ruang kosong sepanjang itu juga.
            <li key={entry.id} className="grid gap-x-8 gap-y-1.5 py-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] xl:items-start">
              <div className="flex flex-wrap items-center gap-2 xl:col-span-2">
                <p className="flex-1 text-base font-medium text-ink">{entry.title}</p>
                <Badge variant="muted">{entry.topic}</Badge>
                {entry.links.length > 0 && <Badge variant="default">{entry.links.length} link</Badge>}
                {entry.prices.length > 0 && <Badge variant="default">{entry.prices.length} harga</Badge>}
              </div>

              <div className="min-w-0 space-y-1.5">
                <p className="max-w-4xl text-sm whitespace-pre-wrap text-ink">
                  {expanded || !truncated ? entry.body : entry.body.slice(0, BODY_PREVIEW_LENGTH)}
                  {!expanded && truncated && '…'}
                </p>

                {truncated && (
                  <button
                    type="button"
                    onClick={() => setExpandedId(expanded ? null : entry.id)}
                    className="focus-ring rounded-sm text-xs text-ink-muted underline underline-offset-2 hover:text-ink"
                  >
                    {expanded ? 'Ringkas' : 'Tampilkan selengkapnya'}
                  </button>
                )}
              </div>

              <div className="min-w-0 space-y-1.5">
                {/* The file, not a database id: the way to change any of this is to edit the file. */}
                <p className="font-mono text-xs break-all text-ink-subtle">catalog/{entry.sourceFile}</p>

                {entry.prices.length > 0 && (
                  <p className="text-xs">
                    <span className="text-ink-subtle">Harga: </span>
                    <span className="font-mono text-ink">
                      {entry.prices.map((price) => `Rp ${IDR.format(price)}`).join(' · ')}
                    </span>
                  </p>
                )}

                {entry.links.length > 0 && (
                  <p className="text-xs">
                    <span className="text-ink-subtle">Link: </span>
                    {/* Deliberately not anchors. These are grounding values the bot may cite, and a
                        relative path here is not a route in this app — rendering them as links
                        would send an operator to a 404 inside wa-inbox. */}
                    <span className="font-mono break-all text-ink">{entry.links.join(' · ')}</span>
                  </p>
                )}

                {entry.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {entry.tags.map((tag) => (
                      <Badge key={tag} variant="muted">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

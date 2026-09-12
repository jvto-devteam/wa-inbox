'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Bell } from 'lucide-react'
import { cn } from '@/lib/utils'
import { fetchJson } from '@/lib/fetch-json'

export type GapItem = {
  id: string
  conversationId: string
  /** Kosong pada baris gap lama, yang ditulis sebelum kolomnya ada. */
  messageId: string | null
  contactName: string | null
  topic: string
  reason: string
  messageText: string
  createdAt: string
}

type GapFeed = { count: number; items: GapItem[] }

const REASON_LABEL: Record<string, string> = {
  reply_unsourced: 'Jawaban tanpa sumber',
  no_facts_resolved: 'Tidak ada fakta',
  verification_failed: 'Gagal verifikasi',
}

/**
 * Tanpa id pesan, notifikasi hanya bisa membuka percakapannya -- menebak gelembung mana yang
 * dimaksud (mis. "balasan bot terakhir") akan menyorot jawaban yang salah begitu ada balasan
 * lain sesudahnya.
 */
export function gapHref(gap: GapItem): string {
  const conversation = `/inbox?conversation=${encodeURIComponent(gap.conversationId)}`
  return gap.messageId ? `${conversation}&message=${encodeURIComponent(gap.messageId)}` : conversation
}

/**
 * Lonceng gap knowledge: berapa jawaban bot yang masih menunggu diajari, dan jalan tercepat ke
 * salah satunya. Angka naik seketika lewat event `knowledge.gap`; daftarnya diambil ulang dari
 * API supaya event-nya tidak perlu membawa isi percakapan ke setiap tab yang terbuka.
 */
export function GapBell() {
  const [feed, setFeed] = useState<GapFeed>({ count: 0, items: [] })
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    function load() {
      fetchJson<GapFeed>('/api/inbox/gaps?limit=5')
        .then((next) => {
          if (!cancelled) setFeed(next)
        })
        // Ditelan: lonceng adalah tambahan di atas navigasi, dan kegagalan memuatnya tidak
        // boleh mengubah apa pun di halaman yang sedang dibaca operator.
        .catch(() => {})
    }

    load()
    const es = new EventSource('/api/sse')
    es.onmessage = (e) => {
      const event = JSON.parse(e.data)
      if (event.type === 'knowledge.gap') load()
    }
    return () => {
      cancelled = true
      es.close()
    }
  }, [])

  // Pola yang sama dengan menu akun di AppRail: dropdown di rail yang ada di setiap halaman
  // harus bisa ditutup tanpa memilih apa pun.
  useEffect(() => {
    if (!open) return
    function onPointerDown(e: MouseEvent) {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={boxRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={feed.count > 0 ? `Gap knowledge (${feed.count} belum ditangani)` : 'Gap knowledge'}
        className={cn(
          'focus-ring-inverse flex w-16 shrink-0 flex-col items-center justify-start gap-1 rounded-md px-0.5 py-2',
          'text-center text-[10px] leading-[1.15] font-medium tracking-tight transition-colors',
          'text-white/70 hover:bg-white/10 hover:text-white md:w-full'
        )}
      >
        <span className="relative">
          <Bell aria-hidden="true" className="size-[18px] shrink-0" strokeWidth={1.75} />
          {feed.count > 0 && (
            <span className="absolute -top-1.5 -right-2 min-w-4 rounded-full bg-danger px-1 text-[9px] leading-4 font-semibold text-white tabular-nums">
              {feed.count > 99 ? '99+' : feed.count}
            </span>
          )}
        </span>
        <span className="w-full">Gap</span>
      </button>

      {open && (
        <div
          role="menu"
          className={cn(
            'absolute bottom-full left-0 z-30 mb-2 w-72 rounded-lg border border-line bg-surface p-1 shadow-popover',
            'md:bottom-0 md:left-full md:mb-0 md:ml-2'
          )}
        >
          <p className="px-2 py-1.5 text-xs font-medium text-ink">Jawaban yang perlu knowledge</p>
          {feed.items.length === 0 ? (
            <p className="px-2 pb-2 text-xs text-ink-muted">
              Tidak ada yang menunggu. Setiap jawaban bot terakhir bersandar pada fakta.
            </p>
          ) : (
            <ul className="max-h-80 overflow-y-auto">
              {feed.items.map((gap) => (
                <li key={gap.id}>
                  <Link
                    href={gapHref(gap)}
                    onClick={() => setOpen(false)}
                    className="focus-ring block rounded-md px-2 py-1.5 hover:bg-surface-sunken"
                  >
                    <span className="block text-xs font-medium text-ink">
                      {gap.contactName ?? gap.conversationId} · {gap.topic}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-ink-muted">{gap.messageText}</span>
                    <span className="block text-[11px] text-ink-subtle">{REASON_LABEL[gap.reason] ?? gap.reason}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Link
            href="/settings/knowledge-gaps"
            onClick={() => setOpen(false)}
            className="focus-ring mt-1 block border-t border-line px-2 pt-2 pb-1 text-xs font-medium text-accent hover:underline"
          >
            Lihat semua
          </Link>
        </div>
      )}
    </div>
  )
}

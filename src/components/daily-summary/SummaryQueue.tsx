'use client'
import Link from 'next/link'
import { useState, type ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Textarea } from '@/components/ui/textarea'
import { formatWait } from '@/components/dashboard/data'
import { STAGE_LABELS } from '@/lib/pipeline'
import { jakartaDayKey, jakartaDayRange } from '@/lib/daily-summary/time'
import { fetchJson } from '@/lib/fetch-json'
import { announceSummaryItemsChanged } from '@/lib/summary-items/events'
import { summaryItemKindLabel, wibDateTimeLabel } from '@/lib/summary-items/status'
import type { SummaryItemView } from '@/lib/summary-items/view'
import { PromiseList } from '@/components/daily-summary/QuestionList'
import { conversationHref } from '@/components/daily-summary/conversation-href'

/**
 * Antrean tindakan halaman /summary. Setiap item OPEN punya tiga jalan keluar: dibalas di Inbox
 * (item tertutup sendiri lewat rekonsiliasi), dijadwalkan lewat pengingat, atau dilepas. Tidak
 * ada yang mengirim pesan ke pelanggan dari sini -- "Balas" hanya membuka percakapannya.
 *
 * Kartu "Janji tim" (PROMISE) menampilkan daftar janji dan aksi utamanya "Buka chat" ke pesan
 * janji itu; ia tertutup oleh ringkasan berikutnya yang tidak lagi memuat janji terbuka.
 *
 * Setelah aksi sukses, `onChanged` memuat ulang daftar dan event `summary-items:changed`
 * memberi tahu lencana di AppRail supaya angkanya tidak menunggu putaran 60 detik berikutnya.
 */

const DAY_MS = 24 * 60 * 60 * 1000
const NOTE_MAX = 500

/** Pilihan cepat "Ingatkan": selalu pukul 09.00 WIB, N hari kalender Jakarta dari hari ini. */
const REMIND_OPTIONS: ReadonlyArray<{ days: number; label: string }> = [
  { days: 1, label: 'Besok 09.00' },
  { days: 3, label: '3 hari' },
  { days: 7, label: '7 hari' },
]

/**
 * 09.00 WIB pada hari Jakarta `daysAhead` sesudah hari tempat `now` jatuh, sebagai ISO dengan
 * offset `+07:00`. Dihitung dari tanggal kalender Jakarta, bukan `now + N*24 jam`: pukul 23.30
 * WIB, "besok" tetap berarti besok pagi, bukan lusa. Jakarta tanpa DST, jadi satu hari = 24 jam.
 */
export function jakartaMorningIso(now: Date, daysAhead: number): string {
  const { start } = jakartaDayRange(jakartaDayKey(now))
  const key = jakartaDayKey(new Date(start.getTime() + daysAhead * DAY_MS))
  return `${key}T09:00:00+07:00`
}

export { conversationHref }

function displayName(item: SummaryItemView): string {
  return item.contactName ?? 'Tanpa nama'
}

/** Tanggal hari Jakarta (`YYYY-MM-DD`) sebagai label pendek, mis. "18 Okt 2026". */
export function dateKeyLabel(dateKey: string): string {
  return new Date(`${dateKey}T00:00:00+07:00`).toLocaleDateString('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/**
 * Tautan ke Inbox bergaya tombol kecil. Tautan, bukan <button>, karena tindakannya memang
 * pindah halaman -- dan bisa dibuka di tab baru sambil tetap menyisir antrean ini.
 */
export function ActionLink({ href, children, primary = false }: { href: string; children: ReactNode; primary?: boolean }) {
  return (
    <Link
      href={href}
      className={
        primary
          ? 'focus-ring inline-flex h-7 shrink-0 items-center rounded-md bg-accent px-2.5 text-sm font-medium text-white hover:bg-accent-hover'
          : 'focus-ring inline-flex h-7 shrink-0 items-center rounded-md border border-line-strong bg-surface px-2.5 text-sm font-medium text-ink hover:bg-surface-sunken'
      }
    >
      {children}
    </Link>
  )
}

function ContactLink({ item }: { item: SummaryItemView }) {
  return (
    <Link href={conversationHref(item.conversationId)} className="focus-ring rounded-sm text-base font-medium text-ink hover:underline">
      {displayName(item)}
    </Link>
  )
}

/** Topik + alasan → langkah berikut dari LLM, atau penanda bahwa LLM gagal menilainya. */
export function ReviewLine({ review }: { review: SummaryItemView['review'] }) {
  if (!review) return <Badge variant="warning">Belum dicek LLM</Badge>
  return (
    <div className="space-y-0.5">
      {review.topik && <p className="text-sm font-medium text-ink">{review.topik}</p>}
      <p className="text-sm text-ink-muted">
        {review.alasan}
        {review.langkahBerikut && <span className="text-ink"> → {review.langkahBerikut}</span>}
      </p>
    </div>
  )
}

type Panel = 'remind' | 'drop' | null

/**
 * Tombol "Ingatkan" dan "Lepas" beserta panel kecilnya, untuk satu item OPEN/SCHEDULED. Dipakai
 * antrean ini dan tab "Ringkasan chat" di Inbox -- satu komponen supaya pilihan waktu, batas
 * catatan, dan body yang dikirim tidak bisa berbeda di dua tempat.
 *
 * `children` ditaruh di depan tombol pada baris yang sama (antrean menaruh tautan "Balas" di
 * sana). Setelah aksi sukses: event `summary-items:changed`, lalu `onChanged`.
 */
export function RemindDropActions({
  itemId,
  defaultNote,
  now,
  onChanged,
  children,
}: {
  itemId: string
  /** Isi awal catatan pengingat; dipotong ke batas panjang catatan. */
  defaultNote: string
  /** "Sekarang" untuk pilihan "Ingatkan"; tanpa nilai = saat tombol Jadwalkan ditekan. */
  now?: Date
  onChanged: () => void | Promise<void>
  children?: ReactNode
}) {
  const [panel, setPanel] = useState<Panel>(null)
  const [days, setDays] = useState(REMIND_OPTIONS[0].days)
  const [note, setNote] = useState(() => defaultNote.slice(0, NOTE_MAX))
  const [dropNote, setDropNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function toggle(next: Exclude<Panel, null>) {
    setError(null)
    setPanel((current) => (current === next ? null : next))
  }

  async function submit(url: string, body: unknown) {
    setBusy(true)
    setError(null)
    try {
      await fetchJson<unknown>(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      announceSummaryItemsChanged()
      await onChanged()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Permintaan gagal')
    } finally {
      setBusy(false)
    }
  }

  function schedule() {
    void submit(`/api/summary-items/${encodeURIComponent(itemId)}/schedule`, {
      dueAt: jakartaMorningIso(now ?? new Date(), days),
      note: note.trim(),
    })
  }

  function drop() {
    const trimmed = dropNote.trim()
    // Body JSON selalu dikirim, minimal `{}`: route menolak permintaan tanpa body.
    void submit(`/api/summary-items/${encodeURIComponent(itemId)}/drop`, trimmed ? { note: trimmed } : {})
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 pt-1">
        {children}
        <Button type="button" size="sm" variant="outline" aria-expanded={panel === 'remind'} onClick={() => toggle('remind')}>
          Ingatkan
        </Button>
        <Button type="button" size="sm" variant="ghost" aria-expanded={panel === 'drop'} onClick={() => toggle('drop')}>
          Lepas
        </Button>
      </div>

      {panel === 'remind' && (
        <div className="max-w-xl space-y-2 rounded-md border border-line bg-surface-sunken p-3">
          <div role="group" aria-label="Kapan diingatkan" className="flex flex-wrap gap-1.5">
            {REMIND_OPTIONS.map((option) => (
              <Button
                key={option.days}
                type="button"
                size="sm"
                variant={days === option.days ? 'secondary' : 'outline'}
                aria-pressed={days === option.days}
                onClick={() => setDays(option.days)}
              >
                {option.label}
              </Button>
            ))}
            <span className="self-center text-xs text-ink-muted">pukul 09.00 WIB</span>
          </div>
          <Textarea
            aria-label="Catatan pengingat"
            rows={2}
            maxLength={NOTE_MAX}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <Button type="button" size="sm" disabled={busy || note.trim().length === 0} onClick={schedule}>
            {busy ? 'Menjadwalkan…' : 'Jadwalkan'}
          </Button>
        </div>
      )}

      {panel === 'drop' && (
        <div className="max-w-xl space-y-2 rounded-md border border-line bg-surface-sunken p-3">
          <Textarea
            aria-label="Catatan (opsional)"
            placeholder="Catatan (opsional)"
            rows={2}
            maxLength={NOTE_MAX}
            value={dropNote}
            onChange={(e) => setDropNote(e.target.value)}
          />
          <Button type="button" size="sm" variant="destructive" disabled={busy} onClick={drop}>
            {busy ? 'Melepas…' : 'Lepas item'}
          </Button>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </>
  )
}

const KIND_BADGE: Record<SummaryItemView['kind'], 'destructive' | 'warning' | 'brand'> = {
  REPLY: 'destructive',
  FOLLOW_UP: 'warning',
  PROMISE: 'brand',
}

/** Jeda + teks pemicu untuk kartu terbuka, per jenis. */
function AnchorLines({ item, now }: { item: SummaryItemView; now: Date }) {
  const since = `${formatWait(item.anchorAt, now)} · sejak ${dateKeyLabel(item.openedOn)}`
  if (item.kind === 'PROMISE') {
    const promises = item.review?.janjiTim ?? []
    return (
      <>
        <p className="text-xs text-ink-muted">dijanjikan {since}</p>
        {promises.length > 0 ? (
          <PromiseList promises={promises} conversationId={item.conversationId} />
        ) : (
          item.snippet && <p className="max-w-4xl text-sm text-ink">Janji: “{item.snippet}”</p>
        )}
      </>
    )
  }
  const isReply = item.kind === 'REPLY'
  return (
    <>
      <p className="text-xs text-ink-muted">
        {isReply ? 'menunggu' : 'diam'} {since}
      </p>
      {item.snippet && (
        <p className={isReply ? 'max-w-4xl text-sm text-ink' : 'max-w-4xl text-sm text-ink-muted'}>
          {isReply ? '' : 'Pesan terakhir kita: '}“{item.snippet}”
        </p>
      )}
    </>
  )
}

/** Aksi utama kartu: Balas (ke pesan pelanggan), Follow up, atau Buka chat (ke pesan janji). */
function primaryAction(item: SummaryItemView): { href: string; label: string } {
  switch (item.kind) {
    case 'REPLY':
      return { href: conversationHref(item.conversationId, item.anchorMessageId), label: 'Balas' }
    case 'PROMISE':
      return { href: conversationHref(item.conversationId, item.anchorMessageId, { lihat: true }), label: 'Buka chat' }
    default:
      return { href: conversationHref(item.conversationId), label: 'Follow up' }
  }
}

function OpenItemCard({ item, now, onChanged }: { item: SummaryItemView; now: Date; onChanged: () => void | Promise<void> }) {
  const name = displayName(item)
  const kindLabel = summaryItemKindLabel(item.kind)
  const action = primaryAction(item)
  const fallbackNote = item.kind === 'PROMISE' ? `Tepati janji ke ${name}` : `Follow up ${name}`

  return (
    <li className="space-y-1.5 px-4 py-3" aria-label={`${kindLabel}: ${name}`}>
      <div className="flex flex-wrap items-center gap-2">
        <ContactLink item={item} />
        <Badge variant={KIND_BADGE[item.kind]}>{kindLabel}</Badge>
        {item.handoff && <Badge variant="muted">Handoff</Badge>}
        {item.newLead && <Badge variant="brand">Lead baru</Badge>}
        {item.dueAt && <Badge variant="warning">Pengingat jatuh tempo</Badge>}
        <span className="text-xs text-ink-subtle">{STAGE_LABELS[item.pipelineStage] ?? item.pipelineStage}</span>
      </div>
      <AnchorLines item={item} now={now} />
      <ReviewLine review={item.review} />

      <RemindDropActions
        itemId={item.id}
        defaultNote={item.review?.langkahBerikut || fallbackNote}
        now={now}
        onChanged={onChanged}
      >
        <ActionLink href={action.href} primary>
          {action.label}
        </ActionLink>
      </RemindDropActions>
    </li>
  )
}

function ScheduledItemRow({ item }: { item: SummaryItemView }) {
  return (
    <li className="flex flex-wrap items-center gap-2 px-4 py-2.5" aria-label={`Dijadwalkan: ${displayName(item)}`}>
      <ContactLink item={item} />
      <Badge variant="muted">{summaryItemKindLabel(item.kind)}</Badge>
      {item.dueAt && <span className="text-sm text-ink-muted">diingatkan {wibDateTimeLabel(item.dueAt)}</span>}
      <span className="ml-auto">
        <ActionLink href={conversationHref(item.conversationId)}>Buka chat</ActionLink>
      </span>
    </li>
  )
}

export function SummaryQueue({
  open,
  scheduled,
  now = new Date(),
  onChanged,
}: {
  open: SummaryItemView[]
  scheduled: SummaryItemView[]
  /** "Sekarang" untuk durasi tunggu dan pilihan "Ingatkan"; bisa diisi dari test. */
  now?: Date
  onChanged: () => void | Promise<void>
}) {
  return (
    <div className="space-y-4">
      <section aria-label="Item terbuka" className="rounded-lg border border-line bg-surface">
        {open.length === 0 ? (
          <EmptyState title="Tidak ada item terbuka. Semua sudah dibalas, dijadwalkan, atau dilepas." />
        ) : (
          <ul className="divide-y divide-line">
            {open.map((item) => (
              <OpenItemCard key={item.id} item={item} now={now} onChanged={onChanged} />
            ))}
          </ul>
        )}
      </section>

      {scheduled.length > 0 && (
        <details className="rounded-lg border border-line bg-surface">
          <summary className="focus-ring cursor-pointer px-4 py-2.5 text-base font-semibold text-ink">
            Dijadwalkan ({scheduled.length})
          </summary>
          <ul className="divide-y divide-line border-t border-line">
            {scheduled.map((item) => (
              <ScheduledItemRow key={item.id} item={item} />
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

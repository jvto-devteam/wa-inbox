'use client'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { IconButton } from '@/components/ui/icon-button'
import { SkeletonText } from '@/components/ui/skeleton'
import { RemindDropActions, conversationHref, dateKeyLabel } from '@/components/daily-summary/SummaryQueue'
import { SnapshotStatusBadge } from '@/components/daily-summary/SnapshotStatusBadge'
import { PointList, PromiseList, QuestionList } from '@/components/daily-summary/QuestionList'
import type { ChatReviewHistoryEntry } from '@/lib/chat-review/history'
import { normalizePromise, normalizeQuestion, type ConversationReview } from '@/lib/daily-summary/payload-schema'
import { scrollToThreadMessage } from '@/lib/inbox/message-anchor'
import { fetchJson } from '@/lib/fetch-json'
import { announceSummaryItemsChanged } from '@/lib/summary-items/events'
import { followUpStatus, isActionable, summaryItemKindLabel, wibDateTimeLabel } from '@/lib/summary-items/status'
import { fieldLabel, valueText } from '@/lib/booking-actions/view'
import { PanelSectionTitle } from './ContactPanel'
// Hanya tipe: route itu menyentuh prisma, dan komponen klien tidak boleh membawa modul server.
import type { ChatReviewItem, ChatReviewResponse } from '@/app/api/conversations/[id]/chat-review/route'

/**
 * Tab "Ringkasan chat" di panel kanan Inbox -- versi ringkas (owner 2026-10-22: hanya yang menjawab "apa yang harus
 * admin lakukan sekarang"). Urutan: permintaan booking yang belum dipenuhi (disematkan), satu baris status tindak lanjut
 * + waktu ringkasan + tombol perbarui, lalu yang BELUM selesai (pertanyaan belum terjawab, janji belum dipenuhi,
 * langkah berikut). Yang sudah selesai, poin penting tamu yang sudah booking (sama dengan data booking di tab Kontak),
 * dan riwayat harian dilipat. Sengaja tidak ditampilkan: lencana status/jenis kontak, topik, "sudah dijawab tim",
 * "ada pesan baru" (ringkasan diperbarui sendiri saat chat dibuka), dan riwayat perubahan booking (ada di tab Kontak).
 * Tidak ada yang mengirim pesan ke pelanggan dari sini.
 */

/** Poin penting yang tampil sebelum dilipat. */
const POINTS_SHOWN = 5

const PINNED_TYPE_LABEL: Record<string, string> = {
  CHANGE: 'Permintaan perubahan · belum dipenuhi',
  TASK: 'Perlu ditindaklanjuti',
  MISMATCH: 'Beda dengan backoffice',
}

/** Tautan ke pesan sumber di thread sebelah; tanpa pesan sumber butir tampil sebagai teks biasa. */
function SourceLink({ conversationId, messageId }: { conversationId: string; messageId: string | null | undefined }) {
  if (!messageId) return null
  return (
    <Link
      href={conversationHref(conversationId, messageId, { lihat: true })}
      scroll={false}
      onClick={() => scrollToThreadMessage(messageId)}
      className="focus-ring inline-flex min-h-11 items-center rounded-sm text-xs text-ink-muted underline decoration-dotted underline-offset-2 hover:text-accent"
    >
      Lihat pesan
    </Link>
  )
}

/** Aksi booking yang masih terbuka, dibaca live; paling atas supaya tidak terlewat. */
function PinnedSection({ pinned, conversationId }: { pinned: ChatReviewResponse['pinned']; conversationId: string }) {
  if (pinned.length === 0) return null
  return (
    <section aria-label="Disematkan" className="space-y-1.5">
      <PanelSectionTitle>Disematkan</PanelSectionTitle>
      <ul className="space-y-1.5">
        {pinned.map((p) => (
          <li key={p.id} className="space-y-0.5 rounded-md border border-warning/40 px-2.5 py-1.5 text-sm break-words">
            <p className="font-medium text-ink">
              {fieldLabel(p.field)}: {valueText(p.proposedValue)}
            </p>
            <p className="text-xs text-warning">{PINNED_TYPE_LABEL[p.type] ?? p.type}</p>
            <SourceLink conversationId={conversationId} messageId={p.sourceMessageId} />
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Lencana status tindak lanjut (live dari `SummaryItem`), sebaris dengan waktu ringkasan. */
function FollowUpBadges({ item }: { item: ChatReviewItem | null }) {
  const status = followUpStatus(item)
  return (
    <>
      {/* Jenis hanya ditulis untuk janji: "Belum dijawab"/"Perlu follow up" sudah menyebut jenisnya. */}
      {item?.kind === 'PROMISE' && <Badge variant="brand">{summaryItemKindLabel(item.kind)}</Badge>}
      <Badge variant={status.variant}>{status.label}</Badge>
      {status.detail && <span className="text-xs text-ink-muted">{status.detail}</span>}
    </>
  )
}

/** Isi yang sekunder, tertutup secara bawaan. */
function Folded({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="text-sm">
      <summary className="focus-ring cursor-pointer rounded-sm py-1 text-xs text-ink-muted">{summary}</summary>
      <div className="pt-1">{children}</div>
    </details>
  )
}

/**
 * Satu ringkasan versi ringkas; dipakai untuk yang terbaru dan tiap hari di riwayat. Butir yang tahu pesan sumbernya
 * menjadi tautan ke pesan itu di thread sebelah (lihat QuestionList).
 */
function CompactReview({ review, conversationId }: { review: ConversationReview; conversationId: string }) {
  const openQuestions = review.pertanyaan.filter((q) => normalizeQuestion(q).terjawab !== true)
  const answered = review.pertanyaan.filter((q) => normalizeQuestion(q).terjawab === true)
  // `?? []`: ringkasan yang tidak lewat skema (cache klien lama) bisa tidak membawa `janjiTim`.
  const promises = review.janjiTim ?? []
  const openPromises = promises.filter((p) => normalizePromise(p).terpenuhi !== true)
  const kept = promises.filter((p) => normalizePromise(p).terpenuhi === true)
  const points = review.poinPenting
  // Tamu yang sudah booking: poin penting sama dengan data booking di tab Kontak, jadi dilipat. Calon tamu: ini
  // satu-satunya tempat destinasi/tanggal/pax tercatat, jadi tampil (maks. POINTS_SHOWN, sisanya dilipat).
  const foldPoints = review.jenisKontak === 'tamu_existing'
  const shownPoints = foldPoints ? [] : points.slice(0, POINTS_SHOWN)
  const foldedPoints = foldPoints ? points : points.slice(POINTS_SHOWN)

  return (
    <div className="space-y-2">
      <QuestionList questions={openQuestions} conversationId={conversationId} label="Belum terjawab" />
      <PromiseList promises={openPromises} conversationId={conversationId} label="Janji tim belum dipenuhi" />
      {review.langkahBerikut && (
        <p className="text-sm text-ink">
          <span className="font-medium text-ink-subtle">Langkah berikut: </span>
          {review.langkahBerikut}
        </p>
      )}
      <PointList points={shownPoints} conversationId={conversationId} />
      {foldedPoints.length > 0 && (
        <Folded summary={foldPoints ? `Poin penting (${foldedPoints.length})` : `${foldedPoints.length} poin lainnya`}>
          <PointList points={foldedPoints} conversationId={conversationId} />
        </Folded>
      )}
      {answered.length > 0 && (
        <Folded summary={`${answered.length} pertanyaan terjawab`}>
          <QuestionList questions={answered} conversationId={conversationId} label="Sudah terjawab" />
        </Folded>
      )}
      {kept.length > 0 && (
        <Folded summary={`${kept.length} janji ditepati`}>
          <PromiseList promises={kept} conversationId={conversationId} label="Sudah ditepati" />
        </Folded>
      )}
    </div>
  )
}

const RESPONDED_HELP =
  'Sudah ada balasan (tim atau bot) sesudah hari itu — belum tentu semua pertanyaan terjawab; lihat tanda ✅/⏳ di ringkasan terbaru.'

/**
 * Penanda "Ditanggapi" untuk entri riwayat yang saat itu belum selesai, kompak di baris `<summary>`
 * supaya terlihat tanpa membuka entri. Tautannya hanya menggulung dan menyorot pesan balasan
 * (`lihat=1`); `stopPropagation` agar klik tidak ikut membuka/menutup `<details>`.
 */
function RespondedIndicator({ entry, conversationId }: { entry: ChatReviewHistoryEntry; conversationId: string }) {
  if (entry.review.status === 'selesai') return null
  const messageId = entry.respondedMessageId
  if (!entry.respondedAt || !messageId) {
    return (
      <span className="text-xs text-warning" title={RESPONDED_HELP}>
        Belum ditanggapi
      </span>
    )
  }
  const who = entry.respondedBy === 'BOT' ? 'Dibalas bot' : 'Ditanggapi'
  return (
    <Link
      href={conversationHref(conversationId, messageId, { lihat: true })}
      scroll={false}
      title={RESPONDED_HELP}
      onClick={(e) => {
        e.stopPropagation()
        scrollToThreadMessage(messageId)
      }}
      className="focus-ring rounded-sm text-xs text-ink-muted underline decoration-dotted underline-offset-2 hover:text-accent"
    >
      {who} {wibDateTimeLabel(entry.respondedAt, { compact: true })}
    </Link>
  )
}

/** Riwayat harian dalam satu lipatan; tiap hari tetap bisa dibuka sendiri. */
function HistorySection({ history, conversationId }: { history: ChatReviewResponse['history']; conversationId: string }) {
  if (history.length === 0) return null
  return (
    <details aria-label="Riwayat" className="text-sm">
      <summary className="focus-ring cursor-pointer rounded-sm py-1 text-xs text-ink-muted">Riwayat ({history.length} hari)</summary>
      <div className="space-y-1.5 pt-1">
        {history.map((entry) => (
          <details key={entry.date} className="rounded-md border border-line">
            <summary className="focus-ring flex cursor-pointer flex-wrap items-center gap-1.5 px-2.5 py-1.5 text-sm">
              <span className="font-medium text-ink">{dateKeyLabel(entry.date)}</span>
              <SnapshotStatusBadge status={entry.review.status} />
              <RespondedIndicator entry={entry} conversationId={conversationId} />
            </summary>
            <div className="space-y-2 border-t border-line px-2.5 py-2">
              {entry.review.status !== 'selesai' && <p className="text-xs text-ink-subtle">{RESPONDED_HELP}</p>}
              <CompactReview review={entry.review} conversationId={conversationId} />
            </div>
          </details>
        ))}
      </div>
    </details>
  )
}

export function ChatReviewTab({ conversationId, contactName }: { conversationId: string; contactName?: string | null }) {
  const [data, setData] = useState<ChatReviewResponse | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)

  const url = `/api/conversations/${encodeURIComponent(conversationId)}/chat-review`

  useEffect(() => {
    let active = true
    fetchJson<ChatReviewResponse>(url)
      .then((body) => {
        if (active) setData(body)
      })
      .catch((err: unknown) => {
        if (active) setLoadError(err instanceof Error ? err.message : 'Gagal memuat ringkasan')
      })
    return () => {
      active = false
    }
  }, [url])

  const reload = useCallback(async () => {
    try {
      setData(await fetchJson<ChatReviewResponse>(url))
      setLoadError(null)
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : 'Gagal memuat ringkasan')
    }
  }, [url])

  // Jalur SSE yang sama dengan ConversationList/BookingActionsSection. Review baru dari
  // auto-refresh datang sebagai `conversation.updated`, aksi booking sebagai `booking-actions.changed`.
  // Tanpa EventSource (jsdom, peramban lama) tab tetap jalan, hanya tidak hidup.
  useEffect(() => {
    if (typeof EventSource === 'undefined') return
    const es = new EventSource('/api/sse')
    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as { type?: string; conversationId?: string }
        if (
          event.conversationId === conversationId &&
          (event.type === 'conversation.updated' || event.type === 'booking-actions.changed')
        ) {
          void reload()
        }
      } catch {
        // Event rusak diabaikan.
      }
    }
    return () => es.close()
  }, [conversationId, reload])

  async function refresh() {
    setRefreshing(true)
    setRefreshError(null)
    try {
      setData(await fetchJson<ChatReviewResponse>(url, { method: 'POST' }))
      // Perbarui bisa membuat, membuka lagi, atau menutup item "Janji tim": lencana menu ikut berubah.
      announceSummaryItemsChanged()
    } catch (err: unknown) {
      setRefreshError(err instanceof Error ? err.message : 'Gagal meringkas. Coba lagi.')
    } finally {
      setRefreshing(false)
    }
  }

  if (!data) {
    if (loadError) {
      return (
        <p role="alert" className="text-sm text-danger">
          {loadError}
        </p>
      )
    }
    return (
      <div aria-busy="true" className="space-y-4">
        <SkeletonText lines={3} />
        <SkeletonText lines={4} />
      </div>
    )
  }

  // Belum ada hasil terbaru tetapi riwayat harian ada: ringkasan harian terakhir jadi yang terbaru.
  const fallback = !data.latest && data.history.length > 0 ? data.history[0] : null
  const latest = data.latest ?? (fallback ? { review: fallback.review, at: null } : null)
  const latestLabel = data.latest
    ? `Diperbarui ${wibDateTimeLabel(data.latest.at)}`
    : fallback
      ? `Dari ringkasan harian ${dateKeyLabel(fallback.date)}`
      : 'Belum ada ringkasan.'
  const defaultNote = latest?.review.langkahBerikut || `Follow up ${contactName || 'Tanpa nama'}`
  // Riwayat tanpa entri yang sudah dipakai sebagai "terbaru" (cadangan): tidak tampil dua kali.
  const history = fallback ? data.history.slice(1) : data.history

  return (
    <div className="flex flex-col gap-3">
      <PinnedSection pinned={data.pinned} conversationId={conversationId} />

      <section aria-label="Ringkasan chat" className="space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <FollowUpBadges item={data.item} />
          <span className="text-xs text-ink-muted">{latestLabel}</span>
          <IconButton
            label={refreshing ? 'Meringkas…' : 'Perbarui sekarang'}
            icon={<RefreshCw className={refreshing ? 'animate-spin' : undefined} strokeWidth={1.75} />}
            size="sm"
            disabled={refreshing}
            onClick={() => void refresh()}
          />
        </div>
        {isActionable(data.item) && (
          // `key`: aksi item lain (setelah dilepas lalu muncul item baru) mulai dari panel tertutup.
          <RemindDropActions key={data.item.id} itemId={data.item.id} defaultNote={defaultNote} onChanged={reload} />
        )}
        {loadError && (
          // Aksi berhasil tetapi muat ulang gagal: status di atas bisa sudah basi, jadi katakan.
          <p role="alert" className="text-sm text-danger">
            {loadError}
          </p>
        )}
        {refreshError && (
          <p role="alert" className="text-sm text-danger">
            {refreshError}
          </p>
        )}
        {latest && <CompactReview review={latest.review} conversationId={conversationId} />}
      </section>

      <HistorySection history={history} conversationId={conversationId} />
    </div>
  )
}

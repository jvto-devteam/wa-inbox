'use client'
import { useEffect, useId, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SkeletonText } from '@/components/ui/skeleton'
import { RemindDropActions, dateKeyLabel } from '@/components/daily-summary/SummaryQueue'
import { PointList, QuestionList } from '@/components/daily-summary/QuestionList'
import type { ConversationReview } from '@/lib/daily-summary/payload-schema'
import { isDateKey, jakartaDayRange } from '@/lib/daily-summary/time'
import { fetchJson } from '@/lib/fetch-json'
import { followUpStatus, isActionable, wibDateTimeLabel } from '@/lib/summary-items/status'
import { PanelSectionTitle } from './ContactPanel'
// Hanya tipe: route itu menyentuh prisma, dan komponen klien tidak boleh membawa modul server.
import type { ChatReviewItem, ChatReviewResponse } from '@/app/api/conversations/[id]/chat-review/route'

/**
 * Tab "Ringkasan chat" di panel kanan Inbox: status tindak lanjut percakapan ini (live dari
 * `SummaryItem`), ringkasan LLM terbaru, dan riwayat per hari dari `DailySummary`.
 *
 * Operator tidak perlu membuka /summary untuk tahu apakah chat yang sedang dibaca masih menunggu
 * jawaban, dan apa saja yang sudah dan belum dijawab. "Perbarui sekarang" meringkas ulang lewat
 * LLM saat diklik; selebihnya isinya hasil job 00.00 WIB. Tidak ada yang mengirim pesan ke
 * pelanggan dari sini.
 */

const REVIEW_STATUS_BADGE: Record<ConversationReview['status'], { label: string; variant: 'destructive' | 'success' | 'muted' }> = {
  perlu_tindakan: { label: 'Perlu tindakan', variant: 'destructive' },
  selesai: { label: 'Selesai', variant: 'success' },
  tidak_jelas: { label: 'Tidak jelas', variant: 'muted' },
}

const CONTACT_KIND_LABEL: Record<ConversationReview['jenisKontak'], string> = {
  calon_tamu: 'Calon tamu',
  tamu_existing: 'Tamu',
  mitra: 'Mitra/vendor',
  lainnya: 'Lainnya',
}

function FollowUpSection({
  item,
  defaultNote,
  onChanged,
  loadError,
}: {
  item: ChatReviewItem | null
  defaultNote: string
  onChanged: () => Promise<void>
  loadError: string | null
}) {
  const status = followUpStatus(item)
  return (
    <section aria-label="Status tindak lanjut" className="space-y-1.5">
      <PanelSectionTitle>Status tindak lanjut</PanelSectionTitle>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={status.variant}>{status.label}</Badge>
        {status.detail && <span className="text-sm text-ink-muted">{status.detail}</span>}
      </div>
      {isActionable(item) && (
        // `key`: aksi item lain (setelah dilepas lalu muncul item baru) mulai dari panel tertutup.
        <RemindDropActions key={item.id} itemId={item.id} defaultNote={defaultNote} onChanged={onChanged} />
      )}
      {loadError && (
        // Aksi berhasil tetapi muat ulang gagal: status di atas bisa sudah basi, jadi katakan.
        <p role="alert" className="text-sm text-danger">
          {loadError}
        </p>
      )}
    </section>
  )
}

function ReviewHeader({ review }: { review: ConversationReview }) {
  const status = REVIEW_STATUS_BADGE[review.status]
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant={status.variant}>{status.label}</Badge>
        <Badge variant="muted">{CONTACT_KIND_LABEL[review.jenisKontak]}</Badge>
      </div>
      {review.topik && <p className="text-sm font-medium text-ink">{review.topik}</p>}
    </div>
  )
}

/**
 * Isi satu ringkasan; dipakai untuk yang terbaru dan untuk tiap hari di riwayat. Butir yang tahu
 * pesan sumbernya menjadi tautan ke pesan itu di thread sebelah (lihat QuestionList).
 */
function ReviewBody({ review, conversationId }: { review: ConversationReview; conversationId: string }) {
  return (
    <div className="space-y-2">
      <QuestionList questions={review.pertanyaan} conversationId={conversationId} />
      <PointList points={review.poinPenting} conversationId={conversationId} />
      {review.statusAgen && (
        <p className="text-sm text-ink">
          <span className="font-medium text-ink-subtle">Sudah dijawab tim: </span>
          {review.statusAgen}
        </p>
      )}
      {review.langkahBerikut && (
        <p className="text-sm text-ink">
          <span className="font-medium text-ink-subtle">Langkah berikut: </span>
          {review.langkahBerikut}
        </p>
      )}
    </div>
  )
}

function HistorySection({ history, conversationId }: { history: ChatReviewResponse['history']; conversationId: string }) {
  if (history.length === 0) return null
  return (
    <section aria-label="Riwayat" className="space-y-1.5">
      <PanelSectionTitle>Riwayat</PanelSectionTitle>
      <div className="space-y-1.5">
        {history.map((entry) => {
          const status = REVIEW_STATUS_BADGE[entry.review.status]
          return (
            <details key={entry.date} className="rounded-md border border-line">
              <summary className="focus-ring flex cursor-pointer flex-wrap items-center gap-1.5 px-2.5 py-1.5 text-sm">
                <span className="font-medium text-ink">{dateKeyLabel(entry.date)}</span>
                {entry.review.topik && <span className="min-w-0 text-ink-muted">{entry.review.topik}</span>}
                <Badge variant={status.variant}>{status.label}</Badge>
              </summary>
              <div className="border-t border-line px-2.5 py-2">
                <ReviewBody review={entry.review} conversationId={conversationId} />
              </div>
            </details>
          )
        })}
      </div>
    </section>
  )
}

/** Akhir hari WIB `dateKey` (ISO) -- "per" ringkasan harian; null bila kuncinya tidak valid. */
function endOfDayIso(dateKey: string): string | null {
  return isDateKey(dateKey) ? jakartaDayRange(dateKey).end.toISOString() : null
}

/** Ada pesan (arah apa pun) yang datang SESUDAH ringkasan yang sedang ditampilkan dibuat. */
export function hasMessagesSince(lastMessageAt: string | null, reviewedAt: string | null): boolean {
  if (!lastMessageAt || !reviewedAt) return false
  return Date.parse(lastMessageAt) > Date.parse(reviewedAt)
}

export function ChatReviewTab({ conversationId, contactName }: { conversationId: string; contactName?: string | null }) {
  const [data, setData] = useState<ChatReviewResponse | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)

  const newMessagesHintId = useId()
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

  async function reload() {
    try {
      setData(await fetchJson<ChatReviewResponse>(url))
      setLoadError(null)
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : 'Gagal memuat ringkasan')
    }
  }

  async function refresh() {
    setRefreshing(true)
    setRefreshError(null)
    try {
      setData(await fetchJson<ChatReviewResponse>(url, { method: 'POST' }))
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
  // Ringkasan terbaru "per" `latest.at`; ringkasan harian cadangan "per" akhir hari itu (WIB).
  const reviewedAt = data.latest ? data.latest.at : fallback ? endOfDayIso(fallback.date) : null
  const showNewMessages = hasMessagesSince(data.lastMessageAt, reviewedAt)

  return (
    <div className="flex flex-col gap-4">
      <FollowUpSection item={data.item} defaultNote={defaultNote} onChanged={reload} loadError={loadError} />

      <section aria-label="Poin penting terbaru" className="space-y-2">
        <PanelSectionTitle>Poin penting terbaru</PanelSectionTitle>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-ink-muted">
            {latestLabel}
          </span>
          {showNewMessages && (
            // Diletakkan tepat sebelum tombolnya: isinya ajakan untuk menekan "Perbarui sekarang".
            <span id={newMessagesHintId} className="text-xs font-medium text-warning">
              Ada pesan baru sejak ringkasan ini.
            </span>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={refreshing}
            aria-describedby={showNewMessages ? newMessagesHintId : undefined}
            onClick={() => void refresh()}
          >
            {refreshing ? 'Meringkas…' : 'Perbarui sekarang'}
          </Button>
        </div>
        {refreshError && (
          <p role="alert" className="text-sm text-danger">
            {refreshError}
          </p>
        )}
        {latest && (
          <>
            <ReviewHeader review={latest.review} />
            <ReviewBody review={latest.review} conversationId={conversationId} />
          </>
        )}
      </section>

      <HistorySection history={data.history} conversationId={conversationId} />
    </div>
  )
}

'use client'
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SkeletonText } from '@/components/ui/skeleton'
import { RemindDropActions, dateKeyLabel, wibDateTimeLabel } from '@/components/daily-summary/SummaryQueue'
import { normalizeQuestion, type ConversationReview } from '@/lib/daily-summary/payload-schema'
import { fetchJson } from '@/lib/fetch-json'
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

const CLOSED_REASON_LABEL: Record<string, string> = {
  REPLIED: 'dibalas',
  REMINDER_DONE: 'pengingat selesai',
  STAGE_ADVANCED: 'tahap pipeline naik',
}

type FollowUpStatus = {
  label: string
  detail: string | null
  variant: 'destructive' | 'warning' | 'success' | 'muted'
}

/** Satu kalimat status untuk item antrean percakapan ini (null = tidak pernah masuk antrean). */
export function followUpStatus(item: ChatReviewItem | null): FollowUpStatus {
  if (!item) return { label: 'Tidak ada di antrean', detail: null, variant: 'muted' }
  switch (item.state) {
    case 'OPEN':
      return item.kind === 'REPLY'
        ? { label: 'Belum dijawab', detail: null, variant: 'destructive' }
        : { label: 'Perlu follow up', detail: null, variant: 'warning' }
    case 'SCHEDULED':
      return { label: item.dueAt ? `Dijadwalkan ${wibDateTimeLabel(item.dueAt)}` : 'Dijadwalkan', detail: null, variant: 'muted' }
    case 'DONE':
      return {
        label: 'Sudah ditindaklanjuti',
        detail: item.closedReason ? (CLOSED_REASON_LABEL[item.closedReason] ?? item.closedReason) : null,
        variant: 'success',
      }
    case 'DROPPED':
      return { label: 'Dilepas', detail: item.note, variant: 'muted' }
    default:
      return { label: item.state, detail: null, variant: 'muted' }
  }
}

function FollowUpSection({
  item,
  defaultNote,
  onChanged,
}: {
  item: ChatReviewItem | null
  defaultNote: string
  onChanged: () => Promise<void>
}) {
  const status = followUpStatus(item)
  const actionable = item && (item.state === 'OPEN' || item.state === 'SCHEDULED')
  return (
    <section aria-label="Status tindak lanjut" className="space-y-1.5">
      <PanelSectionTitle>Status tindak lanjut</PanelSectionTitle>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={status.variant}>{status.label}</Badge>
        {status.detail && <span className="text-sm text-ink-muted">{status.detail}</span>}
      </div>
      {actionable && (
        // `key`: aksi item lain (setelah dilepas lalu muncul item baru) mulai dari panel tertutup.
        <RemindDropActions key={item.id} itemId={item.id} defaultNote={defaultNote} onChanged={onChanged} />
      )}
    </section>
  )
}

function TextList({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null
  return (
    <div className="space-y-0.5">
      <p className="text-xs font-medium text-ink-subtle">{label}</p>
      <ul className="list-disc space-y-0.5 pl-4 text-sm text-ink">
        {items.map((text, i) => (
          <li key={i}>{text}</li>
        ))}
      </ul>
    </div>
  )
}

/** Pertanyaan pelanggan dengan tanda teks (bukan hanya warna); ringkasan lama tanpa tanda. */
function QuestionList({ questions }: { questions: ConversationReview['pertanyaan'] }) {
  if (questions.length === 0) return null
  return (
    <div className="space-y-0.5">
      <p className="text-xs font-medium text-ink-subtle">Yang ditanyakan</p>
      <ul aria-label="Yang ditanyakan" className="space-y-1 text-sm text-ink">
        {questions.map((raw, i) => {
          const q = normalizeQuestion(raw)
          return (
            <li key={i} className="flex flex-wrap items-baseline gap-x-1.5">
              <span>{q.teks}</span>
              {q.terjawab === true && <span className="text-xs font-medium text-success">✅ terjawab</span>}
              {q.terjawab === false && <span className="text-xs font-medium text-warning">⏳ belum</span>}
            </li>
          )
        })}
      </ul>
    </div>
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

/** Isi satu ringkasan; dipakai untuk yang terbaru dan untuk tiap hari di riwayat. */
function ReviewBody({ review }: { review: ConversationReview }) {
  return (
    <div className="space-y-2">
      <QuestionList questions={review.pertanyaan} />
      <TextList label="Poin penting" items={review.poinPenting} />
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

function HistorySection({ history }: { history: ChatReviewResponse['history'] }) {
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
                <ReviewBody review={entry.review} />
              </div>
            </details>
          )
        })}
      </div>
    </section>
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

  const latest = data.latest
  const defaultNote = latest?.review.langkahBerikut || `Follow up ${contactName || 'Tanpa nama'}`

  return (
    <div className="flex flex-col gap-4">
      <FollowUpSection item={data.item} defaultNote={defaultNote} onChanged={reload} />

      <section aria-label="Poin penting terbaru" className="space-y-2">
        <PanelSectionTitle>Poin penting terbaru</PanelSectionTitle>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-ink-muted">
            {latest ? `Diperbarui ${wibDateTimeLabel(latest.at)}` : 'Belum ada ringkasan.'}
          </span>
          <Button type="button" size="sm" variant="outline" disabled={refreshing} onClick={() => void refresh()}>
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
            <ReviewBody review={latest.review} />
          </>
        )}
      </section>

      <HistorySection history={data.history} />
    </div>
  )
}

'use client'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { ActionLink, RemindDropActions, ReviewLine, conversationHref } from '@/components/daily-summary/SummaryQueue'
import { QuestionList } from '@/components/daily-summary/QuestionList'
import type { ConversationReview, DailySummaryPayload } from '@/lib/daily-summary/payload-schema'
import { followUpStatus, isActionable, type SummaryItemStatus } from '@/lib/summary-items/status'

/**
 * Tampilan satu tanggal di /summary: apa yang terjadi hari itu (label dan ringkasan LLM dari
 * payload `DailySummary`) DAN status tindak lanjut tiap percakapan SEKARANG (`SummaryItem`).
 *
 * Aturan owner: tidak ada data di halaman ini yang berhenti di "dibaca saja". Karena itu setiap
 * kartu membawa "Buka chat", dan item yang masih OPEN/SCHEDULED bisa langsung diingatkan atau
 * dilepas dari sini -- komponen aksinya sama dengan antrean, jadi body yang dikirim tidak bisa
 * berbeda. Yang masih terbuka diurutkan paling atas.
 */

type DayLabel = 'unreplied' | 'dormant' | 'newLead' | 'handoff'

const DAY_LABELS: ReadonlyArray<{ key: DayLabel; label: string; variant: 'destructive' | 'warning' | 'brand' | 'muted' }> = [
  { key: 'unreplied', label: 'Belum dibalas', variant: 'destructive' },
  { key: 'dormant', label: 'Pelanggan diam', variant: 'warning' },
  { key: 'newLead', label: 'Lead baru', variant: 'brand' },
  { key: 'handoff', label: 'Handoff', variant: 'muted' },
]

type DayConversation = {
  conversationId: string
  contactName: string | null
  labels: Set<DayLabel>
  review: ConversationReview | null
}

/** Satu entri per percakapan, urutan kemunculan pertama di payload. */
function collectConversations(payload: DailySummaryPayload): DayConversation[] {
  const byId = new Map<string, DayConversation>()
  const add = (
    entry: { conversationId: string; contactName: string | null; review?: ConversationReview | null },
    label: DayLabel | null
  ) => {
    let conv = byId.get(entry.conversationId)
    if (!conv) {
      conv = { conversationId: entry.conversationId, contactName: null, labels: new Set(), review: null }
      byId.set(entry.conversationId, conv)
    }
    conv.contactName ??= entry.contactName
    conv.review ??= entry.review ?? null
    if (label) conv.labels.add(label)
  }
  for (const entry of payload.unreplied) add(entry, 'unreplied')
  for (const entry of payload.dormant) add(entry, 'dormant')
  for (const entry of payload.newLeads) add(entry, 'newLead')
  for (const entry of payload.handoffs) add(entry, 'handoff')
  for (const entry of payload.conversations) add(entry, null)
  return [...byId.values()]
}

const STATE_RANK: Record<string, number> = { OPEN: 0, SCHEDULED: 1 }

function stateRank(item: SummaryItemStatus | undefined): number {
  return item ? (STATE_RANK[item.state] ?? 2) : 2
}

function DayCard({
  conv,
  item,
  onChanged,
}: {
  conv: DayConversation
  item: SummaryItemStatus | null
  onChanged: () => void | Promise<void>
}) {
  const name = conv.contactName ?? 'Tanpa nama'
  const status = followUpStatus(item)
  const href = conversationHref(conv.conversationId)
  const openChat = (
    <ActionLink href={href} primary>
      Buka chat
    </ActionLink>
  )

  return (
    <li className="space-y-1.5 px-4 py-3" aria-label={name}>
      <div className="flex flex-wrap items-center gap-2">
        <Link href={href} className="focus-ring rounded-sm text-base font-medium text-ink hover:underline">
          {name}
        </Link>
        {DAY_LABELS.filter((l) => conv.labels.has(l.key)).map((l) => (
          <Badge key={l.key} variant={l.variant}>
            {l.label}
          </Badge>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-ink-muted">Status sekarang:</span>
        <Badge variant={status.variant}>{status.label}</Badge>
        {status.detail && <span className="text-ink-muted">{status.detail}</span>}
      </div>
      <ReviewLine review={conv.review} />
      {conv.review && <QuestionList questions={conv.review.pertanyaan} />}

      {isActionable(item) ? (
        // `key`: item baru untuk percakapan yang sama mulai dari panel tertutup.
        <RemindDropActions
          key={item.id}
          itemId={item.id}
          defaultNote={conv.review?.langkahBerikut || `Follow up ${name}`}
          onChanged={onChanged}
        >
          {openChat}
        </RemindDropActions>
      ) : (
        <div className="flex flex-wrap items-center gap-2 pt-1">{openChat}</div>
      )}
    </li>
  )
}

export function SummaryDayView({
  payload,
  items,
  onChanged,
}: {
  payload: DailySummaryPayload
  items: Record<string, SummaryItemStatus>
  /** Dipanggil sesudah Ingatkan/Lepas sukses (event `summary-items:changed` sudah dikirim). */
  onChanged: () => void | Promise<void>
}) {
  const { counts, gaps } = payload
  // Array.prototype.sort stabil: di dalam satu kelompok, urutan payload dipertahankan.
  const conversations = collectConversations(payload).sort(
    (a, b) => stateRank(items[a.conversationId]) - stateRank(items[b.conversationId])
  )

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-muted">
        {counts.activeConversations} aktif · {counts.inbound} masuk · {counts.outbound} keluar · {counts.newConversations} kontak baru
        {gaps.newCount > 0 && <> · {gaps.newCount} gap baru hari itu</>}
      </p>

      <section aria-label="Percakapan hari itu" className="rounded-lg border border-line bg-surface">
        {conversations.length === 0 ? (
          <EmptyState title="Tidak ada percakapan pada hari itu." />
        ) : (
          <ul className="divide-y divide-line">
            {conversations.map((conv) => (
              <DayCard key={conv.conversationId} conv={conv} item={items[conv.conversationId] ?? null} onChanged={onChanged} />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

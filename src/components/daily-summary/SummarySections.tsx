import Link from 'next/link'
import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { formatWait } from '@/components/dashboard/data'
import { STAGE_LABELS } from '@/lib/pipeline'
import type {
  ConversationReview,
  ConversationSummaryItem,
  DailySummaryPayload,
  DormantItem,
  HandoffItem,
  NewLeadItem,
  TripBriefSummary,
  UnrepliedItem,
} from '@/lib/daily-summary/payload-schema'

/**
 * Bagian-bagian halaman /summary. Semua murni tampilan dari payload yang sudah tersimpan --
 * tidak ada fetch di sini, jadi setiap bagian bisa diuji hanya dengan satu objek payload.
 *
 * "Sekarang" untuk setiap durasi adalah `windowEnd` (00:00 WIB sesudah hari itu), bukan jam
 * dinding: laporan hari Senin yang dibuka hari Kamis tetap bilang "menunggu 3 jam", bukan "3 hari".
 */

const REASON_LABEL: Record<string, string> = {
  reply_unsourced: 'Jawaban tanpa sumber',
  reply_deferred_knowledge: 'Butuh knowledge tambahan',
  no_facts_resolved: 'Tidak ada fakta',
  verification_failed: 'Gagal verifikasi',
}

const CONTACT_KIND_LABEL: Record<ConversationReview['jenisKontak'], string> = {
  calon_tamu: 'Calon tamu',
  tamu_existing: 'Tamu',
  mitra: 'Mitra/vendor',
  lainnya: 'Lainnya',
}

function conversationHref(conversationId: string, messageId?: string | null): string {
  const base = `/inbox?conversation=${encodeURIComponent(conversationId)}`
  return messageId ? `${base}&message=${encodeURIComponent(messageId)}` : base
}

function jakartaTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' })
}

function ContactLink({ id, name }: { id: string; name: string | null }) {
  return (
    <Link href={conversationHref(id)} className="focus-ring rounded-sm text-base font-medium text-ink hover:underline">
      {name ?? 'Tanpa nama'}
    </Link>
  )
}

function Section({ title, count, children, footer }: { title: string; count: number; children: ReactNode; footer?: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <Badge variant={count > 0 ? 'default' : 'muted'}>{count}</Badge>
      </CardHeader>
      {children}
      {footer && <p className="border-t border-line px-4 py-2 text-xs text-ink-muted">{footer}</p>}
    </Card>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <CardBody className="text-sm text-ink-muted">{children}</CardBody>
}

/** Satu baris alasan + langkah berikut dari LLM, atau penanda bahwa LLM gagal menilainya. */
function ReviewLine({ review }: { review: ConversationReview | null }) {
  if (!review) return <Badge variant="warning">Belum dicek LLM</Badge>
  return (
    <p className="text-sm text-ink-muted">
      {review.alasan}
      {review.langkahBerikut && <span className="text-ink"> → {review.langkahBerikut}</span>}
    </p>
  )
}

function filteredNote(count: number): string | undefined {
  return count > 0 ? `${count} percakapan lain disaring karena dinilai sudah selesai (mis. hanya "ok"/"thanks").` : undefined
}

export function UnrepliedSection({ items, filteredOut, windowEnd }: { items: UnrepliedItem[]; filteredOut: number; windowEnd: string }) {
  const now = new Date(windowEnd)
  return (
    <Section title="Belum dibalas" count={items.length} footer={filteredNote(filteredOut)}>
      {items.length === 0 ? (
        <Empty>Tidak ada pesan pelanggan yang menunggu balasan lebih dari 1 jam.</Empty>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((item) => (
            <li key={item.conversationId} className="space-y-1 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <ContactLink id={item.conversationId} name={item.contactName} />
                <Badge variant="destructive">menunggu {formatWait(item.lastMessageAt, now)}</Badge>
                <span className="text-xs text-ink-subtle">{STAGE_LABELS[item.pipelineStage] ?? item.pipelineStage}</span>
              </div>
              <p className="max-w-4xl text-sm text-ink">“{item.snippet}”</p>
              <ReviewLine review={item.review} />
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

export function DormantSection({ items, filteredOut, windowEnd }: { items: DormantItem[]; filteredOut: number; windowEnd: string }) {
  const now = new Date(windowEnd)
  return (
    <Section title="Pelanggan diam" count={items.length} footer={filteredNote(filteredOut)}>
      {items.length === 0 ? (
        <Empty>Tidak ada lead (tahap Baru/Negosiasi) yang diam 2–14 hari setelah dibalas.</Empty>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((item) => (
            <li key={item.conversationId} className="space-y-1 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <ContactLink id={item.conversationId} name={item.contactName} />
                <Badge variant="warning">diam {formatWait(item.lastMessageAt, now)}</Badge>
                <span className="text-xs text-ink-subtle">{STAGE_LABELS[item.pipelineStage] ?? item.pipelineStage}</span>
              </div>
              <p className="max-w-4xl text-sm text-ink-muted">Pesan terakhir kita: “{item.snippet}”</p>
              <ReviewLine review={item.review} />
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

function tripBriefParts(brief: TripBriefSummary): string[] {
  const parts: string[] = []
  if (brief.destination) parts.push(brief.destination)
  if (brief.dateRange) parts.push(brief.dateRange)
  if (brief.pax !== undefined) parts.push(`${brief.pax} orang`)
  if (brief.dayCount !== undefined) parts.push(`${brief.dayCount} hari`)
  if (brief.origin) parts.push(`dari ${brief.origin}`)
  if (brief.finishCity) parts.push(`selesai di ${brief.finishCity}`)
  return parts
}

export function NewLeadsSection({ items }: { items: NewLeadItem[] }) {
  return (
    <Section title="Lead baru" count={items.length}>
      {items.length === 0 ? (
        <Empty>Tidak ada kontak baru hari itu.</Empty>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((item) => (
            <li key={item.conversationId} className="space-y-1 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <ContactLink id={item.conversationId} name={item.contactName} />
                {item.review && <Badge variant="muted">{CONTACT_KIND_LABEL[item.review.jenisKontak]}</Badge>}
                <time dateTime={item.createdAt} className="font-mono text-xs text-ink-subtle">
                  {jakartaTime(item.createdAt)}
                </time>
              </div>
              {item.tripBrief && tripBriefParts(item.tripBrief).length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {tripBriefParts(item.tripBrief).map((part) => (
                    <Badge key={part} variant="default">
                      {part}
                    </Badge>
                  ))}
                </div>
              )}
              {item.review ? (
                <p className="text-sm text-ink-muted">{item.review.topik}</p>
              ) : (
                <Badge variant="warning">Belum dicek LLM</Badge>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

export function HandoffSection({ items }: { items: HandoffItem[] }) {
  return (
    <Section title="Handoff ke agen" count={items.length}>
      {items.length === 0 ? (
        <Empty>Bot tidak menyerahkan percakapan ke agen hari itu.</Empty>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((item) => (
            <li key={item.runId} className="space-y-1 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <ContactLink id={item.conversationId} name={item.contactName} />
                <time dateTime={item.at} className="font-mono text-xs text-ink-subtle">
                  {jakartaTime(item.at)}
                </time>
                {item.stillWaiting ? <Badge variant="destructive">Masih menunggu</Badge> : <Badge variant="success">Sudah dibalas</Badge>}
              </div>
              <p className="max-w-4xl text-sm text-ink-muted">“{item.inboundText}”</p>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

export function GapSection({ gaps }: { gaps: DailySummaryPayload['gaps'] }) {
  return (
    <Section
      title="Gap knowledge"
      count={gaps.newCount}
      footer={
        <>
          {gaps.openTotal} gap masih terbuka saat laporan dibuat ·{' '}
          <Link href="/settings/knowledge-gaps" className="focus-ring rounded-sm font-medium text-accent hover:underline">
            Lihat semua
          </Link>
        </>
      }
    >
      {gaps.newCount === 0 ? (
        <Empty>Tidak ada gap knowledge baru hari itu.</Empty>
      ) : (
        <>
          <div className="flex flex-wrap gap-1 px-4 pt-3">
            {gaps.byReason.map((entry) => (
              <Badge key={entry.key} variant="muted">
                {REASON_LABEL[entry.key] ?? entry.key}: {entry.count}
              </Badge>
            ))}
            {gaps.byTopic.map((entry) => (
              <Badge key={`topic-${entry.key}`} variant="default">
                {entry.key}: {entry.count}
              </Badge>
            ))}
          </div>
          <ul className="divide-y divide-line">
            {gaps.items.map((gap) => (
              <li key={gap.id} className="px-4 py-2.5">
                <Link href={conversationHref(gap.conversationId, gap.messageId)} className="focus-ring block rounded-sm hover:underline">
                  <span className="text-sm font-medium text-ink">
                    {gap.contactName ?? 'Tanpa nama'} · {gap.topic}
                  </span>
                  <span className="block truncate text-sm text-ink-muted">{gap.messageText}</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </Section>
  )
}

function BulletList({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null
  return (
    <div>
      <p className="text-xs font-medium text-ink-subtle">{label}</p>
      <ul className="list-disc space-y-0.5 pl-5 text-sm text-ink">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  )
}

const STATUS_BADGE: Record<ConversationReview['status'], { label: string; variant: 'destructive' | 'success' | 'muted' }> = {
  perlu_tindakan: { label: 'Perlu tindakan', variant: 'destructive' },
  selesai: { label: 'Selesai', variant: 'success' },
  tidak_jelas: { label: 'Tidak jelas', variant: 'muted' },
}

export function ConversationSummariesSection({ items }: { items: ConversationSummaryItem[] }) {
  return (
    <Section title="Ringkasan per percakapan" count={items.length}>
      {items.length === 0 ? (
        <Empty>Tidak ada percakapan hari itu.</Empty>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((item) => (
            <li key={item.conversationId} className="space-y-2 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <ContactLink id={item.conversationId} name={item.contactName} />
                {item.review && <Badge variant={STATUS_BADGE[item.review.status].variant}>{STATUS_BADGE[item.review.status].label}</Badge>}
                <span className="text-xs text-ink-subtle">
                  {item.inbound} masuk · {item.outbound} keluar
                </span>
              </div>
              {item.review ? (
                <div className="max-w-4xl space-y-2">
                  <p className="text-sm font-medium text-ink">{item.review.topik}</p>
                  <BulletList label="Yang ditanyakan" items={item.review.pertanyaan} />
                  <BulletList label="Poin penting" items={item.review.poinPenting} />
                  {item.review.statusAgen && (
                    <p className="text-sm text-ink-muted">
                      <span className="font-medium text-ink-subtle">Tim: </span>
                      {item.review.statusAgen}
                    </p>
                  )}
                  {item.review.langkahBerikut && (
                    <p className="text-sm text-ink">
                      <span className="font-medium text-ink-subtle">Berikutnya: </span>
                      {item.review.langkahBerikut}
                    </p>
                  )}
                </div>
              ) : (
                <Badge variant="warning">Belum dicek LLM</Badge>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { X } from 'lucide-react'
import { Modal } from '@/components/ui/modal'
import { IconButton } from '@/components/ui/icon-button'
import { fetchJson } from '@/lib/fetch-json'
import type { AttributedLine, BotDecision, DecisionKnowledge } from '@/lib/bot/types'
import type { ReplyVerification } from '@/lib/bot/reply-verifier'
import { splitParagraphs } from '@/lib/bot/reply-attribution'
import { jobLabelName, topicLabelName } from '@/lib/inbox/label-names'

/**
 * "Why did the bot say that?", answered inside the inbox.
 *
 * Two sources, in priority order:
 *
 *   1. `Message.botTrace` — still written on every bot reply exactly as before, and the ONLY
 *      thing thousands of historical rows have. Rendered immediately, with no network wait.
 *   2. `BotDecisionRun` — looked up by messageId. It carries latency, status, flow version and
 *      the run's own id, and it exists even for turns that never produced a message. When one
 *      is found the popover offers a link to the full Decision Logs detail.
 *
 * A message with neither says so plainly rather than rendering an empty box, which an agent
 * would read as the feature being broken.
 */

type Paged = { items: Array<{ id: string }> }

/**
 * `knowledge` (Task 17, Ruling R54) lives on every `BotDecision` variant, `booking_context`
 * included: Task 11 (Ruling R95) attached real assembled knowledge to Mode 3 decisions too
 * (`allManagedFacts()`, via `runBookingContextMode`'s own `knowledgeSink` -- see
 * orchestrator.ts and `DecisionKnowledge`'s own header in types.ts), reversing the earlier
 * Ruling R77 exclusion this function used to encode. No per-mode narrowing is needed any more --
 * `trace.knowledge` type-checks directly since the field is the same optional type on every
 * union member.
 */
function knowledgeOf(trace: BotDecision | null): DecisionKnowledge | undefined {
  if (!trace) return undefined
  return trace.knowledge
}

function replyTextOf(trace: BotDecision | null): string | null {
  if (!trace || trace.mode === 'handoff') return null
  return trace.mode === 'faq' ? trace.draft : trace.reply
}

/** `booking_context` never carries topic/job (see BotDecision in types.ts). */
function classificationOf(trace: BotDecision | null): { topic?: string; job?: string } {
  if (!trace || trace.mode === 'booking_context') return {}
  return { topic: trace.topic, job: trace.job }
}

const VERIFICATION_STATUS_LABEL: Record<ReplyVerification['status'], string> = {
  PASSED: 'Lolos',
  PASSED_AFTER_RETRY: 'Lolos setelah diulang',
  BLOCKED: 'Diblokir',
}

function formatRupiah(amount: number): string {
  return `Rp${amount.toLocaleString('id-ID')}`
}

function excerpt(text: string, max = 80): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function attributedSourceLabel(line: AttributedLine): string {
  if (line.kind === 'catalog') return 'Katalog'
  if (line.title && line.version !== undefined) return `${line.title} v${line.version}`
  return line.title ?? 'Knowledge'
}

export function BotTracePopover({
  trace,
  messageId,
  onClose,
}: {
  trace: BotDecision | null
  messageId?: string
  onClose: () => void
}) {
  // No separate "lookup finished" flag: the link renders exactly when a run id is in hand, and
  // `null` covers all three not-yet states (no messageId, still loading, nothing found). An
  // extra flag would only have existed to be set synchronously inside the effect, which
  // triggers cascading renders.
  const [runId, setRunId] = useState<string | null>(null)
  const knowledge = knowledgeOf(trace)
  const usedFacts = knowledge
    ? [
        ...knowledge.catalogLines.map((line) => ({ line, source: 'Katalog' })),
        ...knowledge.managedLines,
      ]
    : []
  const replyText = replyTextOf(trace)
  const paragraphs = replyText ? splitParagraphs(replyText) : []
  const { topic, job } = classificationOf(trace)
  const alsoTopics = knowledge?.alsoTopics ?? []
  const attributions = knowledge?.attributions
  const verification = trace?.verification

  useEffect(() => {
    if (!messageId) return
    let cancelled = false
    // Rejections are swallowed on purpose: the run link is an enhancement on top of botTrace,
    // which is already on screen. A failed lookup must not replace a trace the agent can read
    // with an error about a link they did not ask for.
    fetchJson<Paged>(`/api/bot-control/decisions?messageId=${encodeURIComponent(messageId)}&limit=1`)
      .then((data) => {
        if (cancelled) return
        setRunId(data.items[0]?.id ?? null)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [messageId])

  return (
    <Modal onClose={onClose} className="max-w-sm space-y-2 text-xs">
      <div className="flex items-start justify-between gap-2">
        <p className="font-mono text-ink-muted uppercase">{trace ? `Mode: ${trace.mode}` : 'Alasan bot'}</p>
        <IconButton size="sm" label="Tutup" icon={<X strokeWidth={2} />} onClick={onClose} className="-mt-1 -mr-1" />
      </div>

      {!trace && <p className="text-ink-muted">Trace tidak tersedia untuk pesan ini</p>}

      {trace?.mode === 'handoff' && <p>{trace.reason}</p>}
      {trace?.mode === 'faq' && <p>Sumber topik: {trace.sourceTopic}</p>}
      {trace?.mode === 'booking_context' && <p>Dijawab dari data booking asli (Booking API).</p>}
      {trace?.mode === 'clarify' && <p>Destinasi belum diketahui -- bot menanyakan ke pelanggan.</p>}

      {(topic || job || alsoTopics.length > 0) && (
        <div className="space-y-1 border-t border-line pt-2">
          <p className="font-medium text-ink">Topik</p>
          {topic && <p className="text-ink-muted">{`Utama: ${topicLabelName(topic)} (${topic})`}</p>}
          {alsoTopics.length > 0 && (
            <p className="text-ink-muted">{`Tambahan: ${alsoTopics.map((t) => `${topicLabelName(t)} (${t})`).join(', ')}`}</p>
          )}
          {job && <p className="text-ink-muted">{`Intent: ${jobLabelName(job)} (${job})`}</p>}
        </div>
      )}

      {/* Task 17 (Ruling R54): "kenapa fakta ini tidak ikut?" -- what was actually sent as
          grounding, with its source, and what the topic gate turned away and why. Each list
          renders only when it has something to show, same convention as the steps block above. */}
      {usedFacts.length > 0 && (
        <div className="space-y-1.5 border-t border-line pt-2">
          <p className="font-medium text-ink">Fakta yang dipakai</p>
          <ul className="space-y-1">
            {usedFacts.map((fact, i) => (
              <li key={i} className="text-ink-muted">
                {fact.line} <span className="text-ink-subtle">— {fact.source}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {knowledge && knowledge.rejected.length > 0 && (
        <div className="space-y-1.5 border-t border-line pt-2">
          <p className="font-medium text-ink">Fakta yang ditolak</p>
          <ul className="space-y-1">
            {knowledge.rejected.map((item, i) => (
              <li key={i} className="text-ink-muted">
                &quot;{item.itemQuestion}&quot; — {item.reason}
              </li>
            ))}
            {/* Ruling R83: `rejected` di atas sudah dibatasi MAX_REJECTED_RECORDED (20) di
                sumbernya -- ini yang membuat sisanya terlihat alih-alih hilang diam-diam.
                `rejectedOmitted` sendiri opsional (lihat header field-nya di types.ts) --
                absen dibaca sama seperti 0. */}
            {(knowledge.rejectedOmitted ?? 0) > 0 && (
              <li className="text-ink-subtle">+{knowledge.rejectedOmitted} lainnya</li>
            )}
          </ul>
        </div>
      )}

      {/* Pencocokan sistem (reply-attribution.ts), bukan kutipan model -- karena itu "cocok dengan". */}
      {replyText !== null && (
        <div className="space-y-1.5 border-t border-line pt-2">
          <p className="font-medium text-ink">Sumber per paragraf</p>
          {attributions === undefined ? (
            <p className="text-ink-muted">Tidak tercatat untuk balasan ini.</p>
          ) : attributions.length === 0 ? (
            <p className="text-ink-muted">Tidak ada paragraf yang cocok dengan fakta mana pun.</p>
          ) : (
            <ul className="space-y-1">
              {attributions.map((attribution) => (
                <li key={attribution.paragraph} className="space-x-1">
                  <span className="text-ink">{`“${excerpt(paragraphs[attribution.paragraph] ?? '')}”`}</span>
                  <span className="text-ink-subtle">{`cocok dengan ${attribution.lines.map(attributedSourceLabel).join('; ')}`}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {verification && (
        <div className="space-y-1 border-t border-line pt-2">
          <p className="font-medium text-ink">Verifikasi</p>
          <p className="text-ink-muted">{`Status: ${VERIFICATION_STATUS_LABEL[verification.status] ?? verification.status}`}</p>
          {verification.fabricatedPrices.length > 0 && (
            <p className="text-ink-muted">{`Harga tidak bersumber: ${verification.fabricatedPrices.map(formatRupiah).join(', ')}`}</p>
          )}
          {verification.unverifiedPrices.length > 0 && (
            <p className="text-ink-muted">{`Harga tidak cocok dengan fakta: ${verification.unverifiedPrices.map(formatRupiah).join(', ')}`}</p>
          )}
          {verification.unknownUrls.length > 0 && (
            <p className="break-all text-ink-muted">{`URL tidak dikenal: ${verification.unknownUrls.join(', ')}`}</p>
          )}
        </div>
      )}

      {runId && (
        <Link
          href={`/bot-control/decisions?run=${runId}`}
          className="focus-ring block rounded-sm border-t border-line pt-2 font-medium text-accent hover:underline"
        >
          Lihat detail keputusan lengkap →
        </Link>
      )}
    </Modal>
  )
}

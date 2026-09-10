'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { X } from 'lucide-react'
import { Modal } from '@/components/ui/modal'
import { IconButton } from '@/components/ui/icon-button'
import { fetchJson } from '@/lib/fetch-json'
import type { BotDecision, DecisionKnowledge } from '@/lib/bot/types'

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
 * `knowledge` (Task 17, Ruling R54) lives on `handoff`/`faq`/`clarify` only -- NOT
 * `booking_context` (Ruling R77, see types.ts's own header on `DecisionKnowledge`). A plain
 * `trace?.knowledge` would not type-check across the whole `BotDecision` union since the
 * `booking_context` member has no such property at all; narrowing it out here first is what
 * lets the rest of this component read `.knowledge` safely.
 */
function knowledgeOf(trace: BotDecision | null): DecisionKnowledge | undefined {
  if (!trace || trace.mode === 'booking_context') return undefined
  return trace.knowledge
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

      {trace?.steps && trace.steps.length > 0 && (
        <ol className="space-y-1.5 border-t border-line pt-2">
          {trace.steps.map((step, i) => (
            <li key={i} className="flex gap-1.5">
              <span className="shrink-0 font-mono text-ink-subtle">{i + 1}.</span>
              <div>
                <p className="font-medium text-ink">{step.label}</p>
                <p className="text-ink-muted">{step.detail}</p>
              </div>
            </li>
          ))}
        </ol>
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
          </ul>
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

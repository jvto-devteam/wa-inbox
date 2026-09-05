'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { fetchJson } from '@/lib/fetch-json'
import type { BotDecision } from '@/lib/bot/types'

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
        <p className="font-mono uppercase text-brand">{trace ? `Mode: ${trace.mode}` : 'Alasan bot'}</p>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Tutup"
          className="h-auto w-auto shrink-0 px-1 py-0.5 text-muted-foreground hover:text-foreground"
          onClick={onClose}
        >
          ✕
        </Button>
      </div>

      {!trace && <p className="text-muted-foreground">Trace tidak tersedia untuk pesan ini</p>}

      {trace?.mode === 'handoff' && <p>{trace.reason}</p>}
      {trace?.mode === 'faq' && <p>Sumber topik: {trace.sourceTopic}</p>}
      {trace?.mode === 'booking_context' && <p>Dijawab dari data booking asli (Booking API).</p>}
      {trace?.mode === 'clarify' && <p>Destinasi belum diketahui -- bot menanyakan ke pelanggan.</p>}

      {trace?.steps && trace.steps.length > 0 && (
        <ol className="space-y-1.5 border-t border-border pt-2">
          {trace.steps.map((step, i) => (
            <li key={i} className="flex gap-1.5">
              <span className="shrink-0 font-mono text-muted-foreground">{i + 1}.</span>
              <div>
                <p className="font-medium text-navy">{step.label}</p>
                <p className="text-muted-foreground">{step.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      )}

      {runId && (
        <Link
          href={`/bot-control/decisions?run=${runId}`}
          className="block border-t border-border pt-2 text-brand hover:underline"
        >
          Lihat detail keputusan lengkap →
        </Link>
      )}
    </Modal>
  )
}

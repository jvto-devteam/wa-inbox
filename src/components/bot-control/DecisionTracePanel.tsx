'use client'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'

export type DecisionRunDetail = {
  id: string
  conversationId: string
  messageId: string | null
  contactName: string | null
  contactPhone: string | null
  mode: string
  status: string
  inboundText: string
  replyText: string | null
  flowKey: string | null
  flowVersion: number | null
  latencyMs: number | null
  trace: unknown
  knowledgeRefs: unknown
  verification: unknown
  error: string | null
  startedAt: string
  finishedAt: string | null
}

export const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'destructive' | 'muted' | 'brand'> = {
  REPLIED: 'success',
  CLARIFIED: 'warning',
  HANDOFF: 'destructive',
  FAILED: 'destructive',
  SKIPPED: 'muted',
  // Visually distinct from every production status: a Test Lab run must never be mistaken for
  // something that actually happened to a customer.
  SIMULATED: 'brand',
}

type TraceStep = { label: string; detail: string }

/** The orchestrator's step list, when the stored trace still carries one. */
function stepsFrom(trace: unknown): TraceStep[] {
  if (typeof trace !== 'object' || trace === null) return []
  const steps = (trace as { steps?: unknown }).steps
  if (!Array.isArray(steps)) return []
  return steps.filter(
    (step): step is TraceStep =>
      typeof step === 'object' && step !== null && typeof (step as TraceStep).label === 'string'
  )
}

function reasonFrom(trace: unknown): string | null {
  if (typeof trace !== 'object' || trace === null) return null
  const reason = (trace as { reason?: unknown }).reason
  return typeof reason === 'string' ? reason : null
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
      {children}
    </div>
  )
}

/**
 * Renders one decision run as readable sections rather than raw JSON (guidebook §11.2: "Trace
 * tidak hanya JSON mentah"). The raw object stays available behind a collapsible for
 * developers, because a rendered summary that hides an unexpected field is worse for debugging
 * than one that admits there is more underneath.
 */
export function DecisionTracePanel({ run }: { run: DecisionRunDetail | null }) {
  const [showRaw, setShowRaw] = useState(false)

  if (!run) return <p className="text-sm text-muted-foreground">Trace tidak tersedia untuk pesan ini</p>

  const steps = stepsFrom(run.trace)
  const reason = reasonFrom(run.trace)

  return (
    <div className="space-y-3 text-sm">
      <Section title="Keputusan akhir">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={STATUS_VARIANT[run.status] ?? 'default'}>{run.status}</Badge>
          <span className="font-mono text-xs uppercase text-brand">{run.mode}</span>
          {run.latencyMs != null && <span className="text-xs text-muted-foreground">{run.latencyMs} ms</span>}
          {run.flowKey && (
            <span className="text-xs text-muted-foreground">
              {run.flowKey} v{run.flowVersion ?? 1}
            </span>
          )}
        </div>
        {reason && <p className="text-foreground">{reason}</p>}
        {/* An error is shown as an error, never folded into the normal reason line. */}
        {run.error && <p className="text-destructive">{run.error}</p>}
      </Section>

      <Section title="Pesan masuk">
        <p className="whitespace-pre-wrap text-foreground">{run.inboundText}</p>
      </Section>

      {run.replyText && (
        <Section title="Balasan">
          <p className="whitespace-pre-wrap text-foreground">{run.replyText}</p>
        </Section>
      )}

      {steps.length > 0 && (
        <Section title="Langkah flow">
          <ol className="space-y-1.5">
            {steps.map((step, i) => (
              <li key={`${step.label}-${i}`} className="flex gap-1.5 text-xs">
                <span className="shrink-0 font-mono text-muted-foreground">{i + 1}.</span>
                <div>
                  <p className="font-medium text-navy">{step.label}</p>
                  <p className="text-muted-foreground">{step.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </Section>
      )}

      {run.knowledgeRefs != null && (
        <Section title="Knowledge yang dipakai">
          <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">{JSON.stringify(run.knowledgeRefs, null, 2)}</pre>
        </Section>
      )}

      {run.verification != null && (
        <Section title="Verifikasi harga/URL">
          <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">{JSON.stringify(run.verification, null, 2)}</pre>
        </Section>
      )}

      <div>
        <button type="button" onClick={() => setShowRaw((prev) => !prev)} className="text-xs text-brand hover:underline">
          {showRaw ? 'Sembunyikan trace mentah' : 'Tampilkan trace mentah'}
        </button>
        {showRaw && (
          <pre className="mt-1 max-h-72 overflow-auto rounded bg-muted p-2 text-xs">
            {JSON.stringify(run.trace, null, 2)}
          </pre>
        )}
      </div>
    </div>
  )
}

import { Card } from '@/components/ui/card'
import type { BotDecision } from '@/lib/bot/types'

// Step-by-step reasoning (src/lib/bot/orchestrator.ts's `trace`) is optional on BotDecision so a
// botTrace row stored before this existed still renders -- it just falls back to the old terse
// one-line summary below instead of a step list.
export function BotTracePopover({ trace }: { trace: BotDecision }) {
  return (
    <Card className="max-w-sm space-y-2 p-3 text-xs shadow-md">
      <p className="font-mono uppercase text-brand">Mode: {trace.mode}</p>
      {trace.mode === 'handoff' && <p>{trace.reason}</p>}
      {trace.mode === 'faq' && <p>Sumber topik: {trace.sourceTopic}</p>}
      {trace.mode === 'funnel' && <p>Tahap berikutnya: {trace.nextState}</p>}
      {trace.mode === 'booking_context' && <p>Dijawab dari data booking asli (Booking API).</p>}
      {trace.steps && trace.steps.length > 0 && (
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
    </Card>
  )
}

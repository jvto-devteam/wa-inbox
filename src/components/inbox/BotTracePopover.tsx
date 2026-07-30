import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import type { BotDecision } from '@/lib/bot/types'

// Step-by-step reasoning (src/lib/bot/orchestrator.ts's `trace`) is optional on BotDecision so a
// botTrace row stored before this existed still renders -- it just falls back to the old terse
// one-line summary below instead of a step list.
export function BotTracePopover({ trace, onClose }: { trace: BotDecision; onClose: () => void }) {
  return (
    <Modal onClose={onClose} className="max-w-sm space-y-2 text-xs">
      <div className="flex items-start justify-between gap-2">
        <p className="font-mono uppercase text-brand">Mode: {trace.mode}</p>
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
      {trace.mode === 'handoff' && <p>{trace.reason}</p>}
      {trace.mode === 'faq' && <p>Sumber topik: {trace.sourceTopic}</p>}
      {trace.mode === 'booking_context' && <p>Dijawab dari data booking asli (Booking API).</p>}
      {trace.mode === 'clarify' && <p>Destinasi belum diketahui -- bot menanyakan ke pelanggan.</p>}
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
    </Modal>
  )
}

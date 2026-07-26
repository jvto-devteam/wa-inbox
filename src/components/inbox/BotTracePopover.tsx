import { Card } from '@/components/ui/card'
import type { BotDecision } from '@/lib/bot/types'

export function BotTracePopover({ trace }: { trace: BotDecision }) {
  return (
    <Card className="p-3 text-xs shadow-md">
      <p className="font-mono uppercase text-brand">Mode: {trace.mode}</p>
      {trace.mode === 'handoff' && <p>{trace.reason}</p>}
      {trace.mode === 'faq' && <p>Sumber topik: {trace.sourceTopic}</p>}
      {trace.mode === 'funnel' && <p>Tahap berikutnya: {trace.nextState}</p>}
      {trace.mode === 'booking_context' && <p>Dijawab dari data booking asli (Booking API).</p>}
    </Card>
  )
}

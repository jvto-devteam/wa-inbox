'use client'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { STATUS_VARIANT } from '@/components/bot-control/DecisionTracePanel'
import type { OverviewDecision, OverviewFailedSend, OverviewTopic } from '@/lib/bot-control/overview'
import { UNANSWERED_TOPIC_WINDOW_DAYS } from '@/lib/bot-control/overview'

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })
}

/** Widget 1: the ten most recent bot decisions, each opening its own trace. */
export function LatestDecisionsWidget({ decisions }: { decisions: OverviewDecision[] }) {
  return (
    <Card className="space-y-2 p-4">
      <h2 className="font-medium text-navy">10 Keputusan Bot Terakhir</h2>
      {decisions.length === 0 ? (
        <p className="text-sm text-muted-foreground">Belum ada keputusan bot yang tercatat.</p>
      ) : (
        <ul className="divide-y">
          {decisions.map((decision) => (
            <li key={decision.id} className="py-2">
              <Link href={`/bot-control/decisions?run=${decision.id}`} className="block hover:underline">
                <div className="flex items-center gap-2">
                  <Badge variant={STATUS_VARIANT[decision.status] ?? 'default'}>{decision.status}</Badge>
                  <span className="text-sm text-navy">{decision.contactName ?? 'Kontak terhapus'}</span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">{timeLabel(decision.startedAt)}</span>
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{decision.inboundPreview}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

/** Widget 2: what customers asked that the bot had no grounding for. */
export function TopUnansweredTopicsWidget({ topics }: { topics: OverviewTopic[] }) {
  return (
    <Card className="space-y-2 p-4">
      <h2 className="font-medium text-navy">Topik Tak Terjawab Teratas</h2>
      <p className="text-xs text-muted-foreground">{UNANSWERED_TOPIC_WINDOW_DAYS} hari terakhir.</p>
      {topics.length === 0 ? (
        <p className="text-sm text-muted-foreground">Tidak ada knowledge gap pada rentang ini.</p>
      ) : (
        <ul className="space-y-1">
          {topics.map((topic) => (
            <li key={topic.topic} className="flex items-center justify-between gap-2 text-sm">
              <span className="text-navy">{topic.topic}</span>
              <span className="shrink-0 font-mono text-xs text-muted-foreground">{topic.count}&times;</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

/**
 * Widget 4: sends that exhausted the retry ladder.
 *
 * Each row links into the conversation rather than to a job id, because the operator's next
 * action is with the customer -- the inbox bubble is where the retry button lives.
 */
export function RecentFailedSendsWidget({ sends }: { sends: OverviewFailedSend[] }) {
  return (
    <Card className="space-y-2 p-4">
      <h2 className="font-medium text-navy">Kiriman Gagal Terbaru</h2>
      {sends.length === 0 ? (
        <p className="text-sm text-muted-foreground">Tidak ada kiriman yang gagal.</p>
      ) : (
        <ul className="divide-y">
          {sends.map((send) => (
            <li key={send.id} className="py-2">
              <Link href={`/inbox?conversation=${send.conversationId}`} className="block hover:underline">
                <div className="flex items-center gap-2">
                  <Badge variant="destructive">{send.channel}</Badge>
                  <span className="text-sm text-navy">{send.contactName ?? 'Kontak terhapus'}</span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    {send.attempts}/{send.maxAttempts} percobaan
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                  {send.lastError ?? 'Tidak ada pesan error yang tercatat.'}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

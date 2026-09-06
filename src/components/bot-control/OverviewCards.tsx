'use client'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import type { OverviewCards as OverviewCardsData } from '@/lib/bot-control/overview'

type Tone = 'success' | 'warning' | 'destructive' | 'muted' | 'default'

type CardSpec = {
  label: string
  value: string
  tone: Tone
  /** Shown under the value when the state needs explaining rather than just reporting. */
  note?: string
}

/**
 * The nine status cards of guidebook §18.1.
 *
 * Tone is assigned by what an operator should DO about a number, not by whether it is large.
 * A handoff is normal work, so it stays neutral no matter how high it climbs; a single failed
 * send is a customer who never got an answer, so it is red at one. Colouring every count would
 * make the page decorative and teach operators to ignore it.
 */
function specsFor(cards: OverviewCardsData): CardSpec[] {
  return [
    {
      label: 'Mode bot',
      value: cards.botMode === 'ON' ? 'On — semua chat' : 'Off — manual',
      tone: cards.botMode === 'ON' ? 'success' : 'muted',
      note: cards.botMode === 'OFF' ? 'Bot hanya aktif di chat yang dinyalakan manual.' : undefined,
    },
    {
      label: 'Outbound default',
      value: cards.outboundDefault === 'UNOFFICIAL' ? 'Unofficial' : 'Official',
      // Guidebook §3 makes Unofficial the default send path; Official as the default is a
      // policy breach worth seeing on the front page rather than discovering from a bill.
      tone: cards.outboundDefault === 'UNOFFICIAL' ? 'success' : 'destructive',
      note: cards.outboundDefault === 'OFFICIAL' ? 'Kebijakan menetapkan Unofficial sebagai jalur harian.' : undefined,
    },
    {
      label: 'Webhook Official',
      value: cards.officialWebhook === 'ACTIVE' ? 'Aktif' : 'Tidak aktif',
      tone: cards.officialWebhook === 'ACTIVE' ? 'success' : 'destructive',
      note: cards.officialWebhook === 'ACTIVE' ? undefined : 'Pesan masuk dari Meta tidak akan diterima.',
    },
    {
      label: 'Provider Unofficial',
      value: cards.unofficialProvider === 'CONFIGURED' ? 'Terkonfigurasi' : 'Belum terkonfigurasi',
      tone: cards.unofficialProvider === 'CONFIGURED' ? 'success' : 'destructive',
      note: cards.unofficialProvider === 'CONFIGURED' ? undefined : 'Jalur kirim harian tidak tersedia.',
    },
    {
      label: 'Sumber knowledge',
      value: String(cards.knowledgeSources),
      tone: cards.knowledgeSources === 0 ? 'warning' : 'default',
      note: cards.knowledgeSources === 0 ? 'Belum ada yang ter-index — jalankan sync di Knowledge Explorer.' : undefined,
    },
    { label: 'Bot run hari ini', value: String(cards.botRunsToday), tone: 'default' },
    { label: 'Handoff hari ini', value: String(cards.handoffToday), tone: 'default' },
    {
      label: 'Knowledge gap hari ini',
      value: String(cards.knowledgeGapsToday),
      tone: cards.knowledgeGapsToday > 0 ? 'warning' : 'default',
    },
    {
      label: 'Kiriman gagal',
      value: String(cards.failedOutboundJobs),
      tone: cards.failedOutboundJobs > 0 ? 'destructive' : 'success',
      note: cards.failedOutboundJobs > 0 ? 'Pesan ini tidak sampai ke customer.' : undefined,
    },
  ]
}

export function OverviewCards({ cards }: { cards: OverviewCardsData }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {specsFor(cards).map((spec) => (
        <Card key={spec.label} className="space-y-1 p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{spec.label}</p>
          {spec.tone === 'default' ? (
            <p className="text-2xl font-semibold text-navy">{spec.value}</p>
          ) : (
            <Badge variant={spec.tone}>{spec.value}</Badge>
          )}
          {spec.note && <p className="text-xs text-muted-foreground">{spec.note}</p>}
        </Card>
      ))}
    </div>
  )
}

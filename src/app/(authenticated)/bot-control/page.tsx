'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { ChannelCapabilityTable } from '@/components/bot-control/ChannelCapabilityTable'
import { OverviewCards } from '@/components/bot-control/OverviewCards'
import {
  LatestDecisionsWidget,
  RecentFailedSendsWidget,
  TopUnansweredTopicsWidget,
} from '@/components/bot-control/OverviewWidgets'
import { fetchJson } from '@/lib/fetch-json'
import type { BotControlOverview } from '@/lib/bot-control/overview'

// Guidebook §18.1: sembilan kartu status dan empat widget. Kartu-kartu ini pernah ditunda
// karena tabelnya (BotDecisionRun, KnowledgeSource, OutboundJob) belum boleh dibuat di Phase 1;
// ketiganya sudah ada sejak Phase 2/3/6, jadi angkanya sekarang benar-benar terbaca.
//
// Halaman ini tetap tidak menampilkan angka yang tidak bisa dipercaya: kalau ringkasannya gagal
// dimuat, yang muncul adalah pesan gagal, bukan deretan nol yang terlihat seperti fakta.
const SECTIONS = [
  {
    href: '/bot-control/flows',
    title: 'Flow Map',
    description: 'Seluruh langkah yang dilalui satu pesan customer, dari webhook Meta sampai balasan terkirim.',
  },
  {
    href: '/bot-control/rules',
    title: 'Rules Registry',
    description: 'Aturan yang mengikat bot: kebijakan channel, larangan mengarang harga/URL, handoff, rate limit.',
  },
  {
    href: '/bot-control/knowledge',
    title: 'Knowledge Explorer',
    description: 'Isi catalog/*.json yang dipakai bot, bisa dicari per topik dan per file.',
  },
  {
    href: '/bot-control/decisions',
    title: 'Decision Logs',
    description: 'Riwayat keputusan bot beserta alasannya, dapat difilter dan dibuka satu per satu.',
  },
  {
    href: '/bot-control/test-lab',
    title: 'Test Lab',
    description: 'Menguji pesan customer terhadap decision engine tanpa mengirim WhatsApp.',
  },
  {
    href: '/bot-control/docs',
    title: 'Documentation',
    description: 'Dokumentasi hidup dari flow, rules, knowledge, dan settings — dapat diunduh sebagai Markdown.',
  },
] as const

export default function BotControlPage() {
  const [overview, setOverview] = useState<BotControlOverview | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchJson<BotControlOverview>('/api/bot-control/overview')
      .then(setOverview)
      .catch(() => setError('Gagal memuat ringkasan Bot Control.'))
  }, [])

  return (
    <main className="mx-auto max-w-4xl space-y-5 p-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold text-navy">Bot Control</h1>
        <p className="text-sm text-muted-foreground">
          Membuka logika bot yang selama ini hanya ada di kode, JSON, dan trace database — supaya bisa diaudit
          sebelum dipercaya.
        </p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {!error && !overview && <p className="text-sm text-muted-foreground">Memuat ringkasan...</p>}
      {overview && <OverviewCards cards={overview.cards} />}

      <div className="grid gap-3 sm:grid-cols-2">
        {SECTIONS.map((section) => (
          <Link key={section.href} href={section.href} className="block">
            <Card className="h-full p-4 transition-colors hover:border-brand">
              <p className="text-sm font-semibold text-navy">{section.title}</p>
              <p className="mt-1 text-xs text-muted-foreground">{section.description}</p>
            </Card>
          </Link>
        ))}
      </div>

      {overview && (
        <div className="grid gap-3 lg:grid-cols-2">
          <LatestDecisionsWidget decisions={overview.latestDecisions} />
          <TopUnansweredTopicsWidget topics={overview.topUnansweredTopics} />
        </div>
      )}
      {overview && <RecentFailedSendsWidget sends={overview.recentFailedSends} />}

      {/* Guidebook §15 acceptance 2: the channel policy has to be VISIBLE in Bot Control, not
          just enforced in code, so an operator knows which features are Official-only before
          they try to use one. */}
      <Card className="space-y-2 p-4">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold text-navy">Kemampuan per channel</h2>
          <p className="text-xs text-muted-foreground">
            Pengiriman default lewat <strong>Unofficial</strong>. Official dipakai hanya untuk kemampuan yang memang
            tidak bisa lewat Unofficial.
          </p>
        </div>
        <ChannelCapabilityTable />
      </Card>
    </main>
  )
}

'use client'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { ChannelCapabilityTable } from '@/components/bot-control/ChannelCapabilityTable'

// Overview versi Phase 1: hanya pintu masuk ke yang sudah nyata ada.
//
// Guidebook §18.1 mendaftar sembilan kartu metrik untuk halaman ini, dan delapan di antaranya
// membaca data yang tabelnya belum dibuat (BotDecisionRun, KnowledgeSource, OutboundJob) —
// tabel-tabel yang memang belum boleh dibuat, karena Phase 1 dilarang membuat migration.
// Menampilkan kartu "Bot runs hari ini: 0" yang angkanya tidak pernah bisa benar akan
// merusak kepercayaan pada halaman yang seluruh gunanya adalah dipercaya.
const SECTIONS = [
  {
    href: '/bot-control/flows',
    title: 'Flow Map',
    description: 'Seluruh langkah yang dilalui satu pesan customer, dari webhook Meta sampai balasan terkirim.',
    ready: true,
  },
  {
    href: '/bot-control/rules',
    title: 'Rules Registry',
    description: 'Aturan yang mengikat bot: kebijakan channel, larangan mengarang harga/URL, handoff, rate limit.',
    ready: true,
  },
  {
    href: '/bot-control/knowledge',
    title: 'Knowledge Explorer',
    description: 'Isi catalog/*.json yang dipakai bot, bisa dicari per topik dan per file.',
    ready: true,
  },
  {
    href: '/bot-control/decisions',
    title: 'Decision Logs',
    description: 'Riwayat keputusan bot beserta alasannya, dapat difilter dan dibuka satu per satu.',
    ready: true,
  },
  {
    href: '/bot-control/test-lab',
    title: 'Test Lab',
    description: 'Menguji pesan customer terhadap decision engine tanpa mengirim WhatsApp.',
    ready: true,
  },
  {
    href: '/bot-control/docs',
    title: 'Documentation',
    description: 'Dokumentasi hidup dari flow, rules, knowledge, dan settings — dapat diunduh sebagai Markdown.',
    ready: true,
  },
] as const

export default function BotControlPage() {
  return (
    <main className="mx-auto max-w-4xl space-y-5 p-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold text-navy">Bot Control</h1>
        <p className="text-sm text-muted-foreground">
          Membuka logika bot yang selama ini hanya ada di kode, JSON, dan trace database — supaya bisa diaudit
          sebelum dipercaya.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {SECTIONS.map((section) =>
          section.ready ? (
            <Link key={section.href} href={section.href} className="block">
              <Card className="h-full p-4 transition-colors hover:border-brand">
                <p className="text-sm font-semibold text-navy">{section.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">{section.description}</p>
              </Card>
            </Link>
          ) : (
            // Bukan link. Halaman-halaman ini belum ada; menautkannya berarti mengirim
            // operator ke 404 dan mengajarkan bahwa menu ini tidak bisa dipercaya.
            <Card key={section.href} className="h-full bg-muted/30 p-4">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-muted-foreground">{section.title}</p>
                <span className="badge bg-slate-100 text-slate-600">Belum tersedia</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{section.description}</p>
            </Card>
          )
        )}
      </div>

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

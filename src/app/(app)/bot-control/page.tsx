'use client'
import { useState } from 'react'
import { ChannelCapabilityTable } from '@/components/bot-control/ChannelCapabilityTable'
import { FlowMapReference } from '@/components/bot-control/FlowMapReference'
import { RulesReference } from '@/components/bot-control/RulesReference'
import { PageHeader } from '@/components/ui/page-header'
import { FormSection } from '@/components/settings/section'
import { cn } from '@/lib/utils'

// Referensi Bot Control: tiga bacaan statis tentang apa yang bot lakukan, dalam satu halaman.
// Dulu Ringkasan, Flow Map, dan Rules menempati tiga item menu, padahal ketiganya read-only dan
// tidak ada satu pun yang dibuka saat operator sedang mengerjakan sesuatu (audit 2026-10-31).
//
// Halaman ini dulu berisi kartu-kartu yang seluruh isinya adalah link ke bagian lain — sebuah
// papan penunjuk arah yang harus dilewati sebelum sampai ke tempat tujuan, dan harus didatangi
// lagi setiap kali operator ingin pindah bagian. Papan penunjuk itu sekarang menjadi baris tab
// di `layout.tsx`, yang terlihat dari SEMUA halaman Bot Control, bukan cuma dari sini.
//
// Yang tersisa di sini adalah satu-satunya isi halaman ini yang bukan tautan: tabel kemampuan
// per channel. Karena itu /bot-control tetap menjadi halaman, bukan redirect ke bagian pertama:
// tabel ini tidak punya rumah lain (halaman /bot-control/channel-policy sudah dihapus), dan
// redirect berarti menghapus jawaban "fitur mana yang Official-only" dari UI — padahal
// guidebook §15 acceptance 2 mensyaratkan kebijakan channel TERLIHAT di Bot Control, bukan
// hanya ditegakkan di kode. Tetap sebagai halaman juga membuat tautan "Bot Control" di AppRail
// mendarat di sesuatu yang nyata, tanpa lompatan yang bisa berputar.
//
// Tahap 1B: tabelnya tidak lagi dibungkus Card. Satu tabel di dalam satu kartu adalah dua
// kotak untuk satu isi; yang memisahkannya dari halaman sudah garis rambutnya sendiri.
const VIEWS = [
  { id: 'channel', label: 'Kemampuan channel' },
  { id: 'flow', label: 'Flow Map' },
  { id: 'rules', label: 'Rules' },
] as const

type ViewId = (typeof VIEWS)[number]['id']

export default function BotControlPage() {
  const [view, setView] = useState<ViewId>('channel')

  return (
    <main className="mx-auto w-full max-w-[1600px] space-y-6 p-6">
      <PageHeader
        title="Bot Control"
        description="Membuka logika bot yang selama ini hanya ada di kode, JSON, dan trace database — supaya bisa diaudit sebelum dipercaya. Pilih bagiannya di menu atas."
      />

      <div role="tablist" aria-label="Referensi bot" className="flex gap-5 border-b border-line">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            role="tab"
            aria-selected={view === v.id}
            onClick={() => setView(v.id)}
            className={cn(
              'focus-ring -mb-px border-b-2 px-0.5 pb-2 font-medium transition-colors',
              view === v.id ? 'border-accent text-ink' : 'border-transparent text-ink-muted hover:text-ink'
            )}
          >
            {v.label}
          </button>
        ))}
      </div>

      {view === 'flow' && <FlowMapReference onOpenRules={() => setView('rules')} />}
      {view === 'rules' && <RulesReference />}
      {view === 'channel' && (
        <>
          {/* Guidebook §15 acceptance 2: the channel policy has to be VISIBLE in Bot Control, not
              just enforced in code, so an operator knows which features are Official-only before
              they try to use one. */}
          {/* Dulu seksi tanpa wadah dengan judul di kiri dan tabel di kanan. Diganti panel berbatas
              supaya sekata dengan Beranda, Kontak, dan halaman pengaturan — pemilik menandai bahwa
              halaman yang memakai pemisah garis-atas terbaca "asal taruh" di sebelah halaman yang
              isinya ada di dalam permukaan berbatas. */}
          {/* `bodyClassName="p-0"`: seluruh isi bagian ini adalah satu tabel, jadi tabelnya menempel
              ke tepi panel dan garis rambut kepala menjadi garis atasnya — satu batas, bukan wadah
              tabel berbatas di dalam panel berbatas. `overflow-hidden` menjaga baris terakhir tetap
              di dalam sudut yang dibulatkan. */}
          <FormSection
            className="overflow-hidden"
            bodyClassName="p-0"
            title="Kemampuan per channel"
            description={
              <>
                Pengiriman default lewat <strong className="font-medium text-ink">Unofficial</strong>. Official
                dipakai hanya untuk kemampuan yang memang tidak bisa lewat Unofficial.
              </>
            }
          >
            <ChannelCapabilityTable />
          </FormSection>
        </>
      )}
    </main>
  )
}

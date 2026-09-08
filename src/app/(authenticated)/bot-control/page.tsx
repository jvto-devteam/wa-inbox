'use client'
import { Card } from '@/components/ui/card'
import { ChannelCapabilityTable } from '@/components/bot-control/ChannelCapabilityTable'
import { PageHeader } from '@/components/ui/page-header'

// Ringkasan Bot Control.
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
export default function BotControlPage() {
  return (
    <main className="mx-auto max-w-4xl space-y-5 p-6">
      <PageHeader
        title="Bot Control"
        description="Membuka logika bot yang selama ini hanya ada di kode, JSON, dan trace database — supaya bisa diaudit sebelum dipercaya. Pilih bagiannya di menu atas."
      />

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

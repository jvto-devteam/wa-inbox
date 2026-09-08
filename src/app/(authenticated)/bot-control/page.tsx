'use client'
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
//
// Tahap 1B: tabelnya tidak lagi dibungkus Card. Satu tabel di dalam satu kartu adalah dua
// kotak untuk satu isi; yang memisahkannya dari halaman sudah garis rambutnya sendiri.
export default function BotControlPage() {
  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <PageHeader
        title="Bot Control"
        description="Membuka logika bot yang selama ini hanya ada di kode, JSON, dan trace database — supaya bisa diaudit sebelum dipercaya. Pilih bagiannya di menu atas."
      />

      {/* Guidebook §15 acceptance 2: the channel policy has to be VISIBLE in Bot Control, not
          just enforced in code, so an operator knows which features are Official-only before
          they try to use one. */}
      <section className="space-y-2 border-t border-line pt-5">
        <div className="space-y-0.5">
          <h2 className="text-base font-semibold text-ink">Kemampuan per channel</h2>
          <p className="text-sm text-ink-muted">
            Pengiriman default lewat <strong className="font-medium text-ink">Unofficial</strong>. Official dipakai
            hanya untuk kemampuan yang memang tidak bisa lewat Unofficial.
          </p>
        </div>
        <ChannelCapabilityTable />
      </section>
    </main>
  )
}

import { BotControlNav } from '@/components/bot-control/BotControlNav'
import { SectionNavLayout, SectionNavPane } from '@/components/ui/section-nav'

// Layout Bot Control: satu sidebar bagian di kiri setiap halaman di bawah /bot-control.
//
// Alasannya struktural, sama seperti (authenticated)/layout.tsx menaruh <AppRail> di grup rute:
// "berada di dalam Bot Control" dan "harus melihat menu Bot Control" adalah himpunan halaman
// yang sama, jadi batasnya didefinisikan sekali di sini alih-alih diingat ulang oleh tiap
// halaman. Halaman baru yang ditambahkan di direktori ini otomatis mendapatkan navigasinya.
//
// Sebelumnya ini baris tab horizontal di atas isi halaman. Bentuk sidebar-nya sekarang sama
// persis dengan bagian di /chatbot dan /settings, lewat <SectionNav> yang sama — tiga menu yang
// terlihat mirip sekarang benar-benar satu komponen, bukan tiga salinan yang berpisah pelan.
//
// Tetap SERVER component, dengan alasan yang persis sama seperti layout grup di atasnya: hanya
// <BotControlNav> yang butuh usePathname(), dan menaruh 'use client' di sini akan memaksa
// batasan client pada halaman-halaman di bawahnya tanpa alasan. <SectionNavLayout> dan
// <SectionNavPane> sengaja tidak punya direktif 'use client' supaya itu tetap mungkin.
//
// Tiap halaman di bawah sini membawa <main className="mx-auto max-w-[1600px] p-6"> sendiri, jadi
// panel isinya di sini TIDAK diberi padding lagi — kalau tidak, setiap halaman Bot Control akan
// punya dua lapis padding yang hanya terlihat di layar lebar.
export default function BotControlLayout({ children }: { children: React.ReactNode }) {
  return (
    <SectionNavLayout className="gap-0 lg:gap-0">
      <BotControlNav />
      <SectionNavPane>{children}</SectionNavPane>
    </SectionNavLayout>
  )
}

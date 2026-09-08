import { BotControlNav } from '@/components/bot-control/BotControlNav'

// Layout Bot Control: satu baris tab di atas setiap halaman di bawah /bot-control.
//
// Alasannya struktural, sama seperti (authenticated)/layout.tsx menaruh <AppRail> di grup rute:
// "berada di dalam Bot Control" dan "harus melihat menu Bot Control" adalah himpunan halaman
// yang sama, jadi batasnya didefinisikan sekali di sini alih-alih diingat ulang oleh tiap
// halaman. Halaman baru yang ditambahkan di direktori ini otomatis mendapatkan navigasinya.
//
// Tetap SERVER component, dengan alasan yang persis sama seperti layout grup di atasnya: hanya
// <BotControlNav> yang butuh usePathname(), dan menaruh 'use client' di sini akan memaksa
// batasan client pada halaman-halaman di bawahnya tanpa alasan.
export default function BotControlLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <BotControlNav />
      {children}
    </>
  )
}

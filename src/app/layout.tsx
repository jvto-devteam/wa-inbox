import type { Metadata, Viewport } from 'next'
import { Poppins, IBM_Plex_Mono } from 'next/font/google'
import './globals.css'

// Poppins untuk seluruh teks UI -- pilihan pemilik.
//
// Poppins geometris dan lebih lebar dari grotesk pada ukuran yang sama, jadi skala tipe
// di globals.css sedikit dinaikkan agar tetap terbaca di 11-15px.
//
// IBM Plex Mono DIPERTAHANKAN khusus untuk angka -- nomor telepon, id run, timestamp, dan
// hitungan di tabel. Alasannya bukan selera: angka Poppins proporsional, sehingga kolom
// angka tidak berjajar lurus dan mata harus membaca ulang tiap baris. Mono dipakai HANYA
// di sana, tidak untuk teks yang dibaca.
//
// Bobot dibatasi 400/500/600 -- tidak ada bobot lain di sistem desain, jadi tidak ada
// gunanya mengunduh berkas font yang tidak akan pernah dirujuk.
const poppins = Poppins({
  variable: '--font-poppins',
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
})

const ibmPlexMono = IBM_Plex_Mono({
  variable: '--font-ibm-plex-mono',
  subsets: ['latin'],
  weight: ['400', '500'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'wa-inbox',
  // `manifest` dan apple-icon.png sudah tertaut otomatis lewat konvensi file Next.js
  // (src/app/manifest.ts, src/app/apple-icon.png) -- appleWebApp di sini murni untuk hal yang
  // TIDAK dibaca dari manifest.json oleh iOS: Safari mengabaikan `display: standalone` di
  // manifest untuk PWA yang dibuka lewat "Add to Home Screen", dan butuh meta tag Apple-nya
  // sendiri untuk itu.
  appleWebApp: {
    capable: true,
    title: 'wa-inbox',
    statusBarStyle: 'default',
  },
}

// `themeColor` pindah dari `metadata` ke `viewport` sejak Next 14 -- warnanya sama dengan
// manifest.ts (--color-ink, navy JVTO), supaya address bar/status bar browser di ponsel
// (sebelum di-install) sudah konsisten dengan rupa app sesudah di-install.
export const viewport: Viewport = {
  themeColor: '#0b1b3d',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className={`${poppins.variable} ${ibmPlexMono.variable}`}>
      {/* NotificationListener deliberately lives in src/app/(authenticated)/layout.tsx, not
          here: mounted at the root it also ran on /login, where its EventSource 401s and
          reconnects forever. See that file for the full reasoning. */}
      <body className="font-sans antialiased">{children}</body>
    </html>
  )
}

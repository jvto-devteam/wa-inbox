import type { Metadata } from 'next'
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

export const metadata: Metadata = { title: 'wa-inbox' }

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

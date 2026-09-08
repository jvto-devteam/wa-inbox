import type { Metadata } from 'next'
import { IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google'
import './globals.css'

// IBM Plex Sans (UI) + IBM Plex Mono (data: nomor telepon, id, timestamp, angka tabel).
// Dipilih fungsional, bukan selera: layar ini penuh angka yang harus sejajar, dan angka
// tabular Plex rapi di ukuran kecil yang dipakai sistem desain ini (11-15px).
// Bobot dibatasi 400/500/600 -- tidak ada bobot lain di sistem desain, jadi tidak ada
// gunanya mengunduh berkas font yang tidak akan pernah dirujuk.
const ibmPlexSans = IBM_Plex_Sans({
  variable: '--font-ibm-plex-sans',
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
    <html lang="id" className={`${ibmPlexSans.variable} ${ibmPlexMono.variable}`}>
      {/* NotificationListener deliberately lives in src/app/(authenticated)/layout.tsx, not
          here: mounted at the root it also ran on /login, where its EventSource 401s and
          reconnects forever. See that file for the full reasoning. */}
      <body className="font-sans antialiased">{children}</body>
    </html>
  )
}

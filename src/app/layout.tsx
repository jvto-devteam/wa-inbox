import type { Metadata } from 'next'
import { Plus_Jakarta_Sans } from 'next/font/google'
import './globals.css'

const plusJakartaSans = Plus_Jakarta_Sans({
  variable: '--font-plus-jakarta-sans',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
})

export const metadata: Metadata = { title: 'wa-inbox' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className={plusJakartaSans.variable}>
      {/* NotificationListener deliberately lives in src/app/(authenticated)/layout.tsx, not
          here: mounted at the root it also ran on /login, where its EventSource 401s and
          reconnects forever. See that file for the full reasoning. */}
      <body className="font-sans antialiased">{children}</body>
    </html>
  )
}

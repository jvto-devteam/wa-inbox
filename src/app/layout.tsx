import type { Metadata } from 'next'
import { Plus_Jakarta_Sans } from 'next/font/google'
import { NotificationListener } from '@/components/NotificationListener'
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
      <body className="font-sans antialiased">
        {children}
        <NotificationListener />
      </body>
    </html>
  )
}

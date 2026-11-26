import type { Metadata } from 'next'
import { Figtree } from 'next/font/google'
import { NotificationListener } from '@/components/NotificationListener'
import { NewShell } from '@/components/new/Shell'
import './new.css'

// Aplikasi utama (owner 2026-11-26: tampilan baru menggantikan yang lama di root). Grup route ini mencakup setiap
// halaman yang butuh sesi; middleware menjaganya (tidak ada di PUBLIC_PATHS). /login sengaja di luar grup, jadi
// NotificationListener (SSE + notifikasi browser) tidak pernah terpasang untuk pengunjung yang belum masuk.
const figtree = Figtree({
  variable: '--font-figtree',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
})

export const metadata: Metadata = { title: 'WA Inbox' }

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={figtree.variable}>
      <NewShell>{children}</NewShell>
      <NotificationListener />
    </div>
  )
}

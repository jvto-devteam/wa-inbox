import type { Metadata } from 'next'
import { Figtree } from 'next/font/google'
import { NewShell } from '@/components/new/Shell'
import './new.css'

// Pratinjau tampilan baru (port artifact "New WA Inbox"), sengaja di luar grup
// (authenticated) supaya tidak memakai AppRail lama. Tetap terlindungi middleware:
// /new tidak ada di PUBLIC_PATHS. Semua data di sini DATA CONTOH.
const figtree = Figtree({
  variable: '--font-figtree',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
})

export const metadata: Metadata = { title: 'New WA Inbox' }

export default function NewLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={figtree.variable}>
      <NewShell>{children}</NewShell>
    </div>
  )
}

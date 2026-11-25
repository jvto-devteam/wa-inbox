import type { Metadata } from 'next'
import ContactDetailPage from '@/app/(authenticated)/contacts/[id]/page'
import { LegacyPage } from '@/components/new/LegacyPage'

export const metadata: Metadata = { title: 'Detail kontak · New WA Inbox' }

// Halaman /contacts/[id] apa adanya (booking lengkap, label, catatan, reminder, consent) dengan kulit /new.
export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return <LegacyPage back={{ href: '/new/kontak', label: 'Kontak' }}><ContactDetailPage params={params} /></LegacyPage>
}

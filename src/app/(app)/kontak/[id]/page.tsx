import type { Metadata } from 'next'
import ContactDetailPage from '@/components/legacy-pages/contact-detail/page'
import { LegacyPage } from '@/components/new/LegacyPage'

export const metadata: Metadata = { title: 'Detail kontak · New WA Inbox' }

// Halaman /contacts/[id] apa adanya (booking lengkap, label, catatan, reminder, consent) dengan kulit desain baru.
export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return <LegacyPage back={{ href: '/kontak', label: 'Kontak' }}><ContactDetailPage params={params} /></LegacyPage>
}

import type { Metadata } from 'next'
import KnowledgeExplorerPage from '@/components/legacy-pages/knowledge/page'
import { LegacyPage } from '@/components/new/LegacyPage'

export const metadata: Metadata = { title: 'Knowledge · New WA Inbox' }

// Halaman /bot-control/knowledge apa adanya (kelola, tambah, revisi) dengan kulit desain baru.
export default function Page() {
  return <LegacyPage back={{ href: '/bot', label: 'Bot' }}><KnowledgeExplorerPage /></LegacyPage>
}

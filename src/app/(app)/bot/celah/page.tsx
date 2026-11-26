import type { Metadata } from 'next'
import KnowledgeGapsPage from '@/components/legacy-pages/knowledge-gaps/page'
import { LegacyPage } from '@/components/new/LegacyPage'

export const metadata: Metadata = { title: 'Celah knowledge · New WA Inbox' }

// Halaman /settings/knowledge-gaps apa adanya dengan kulit desain baru.
export default function Page() {
  return <LegacyPage back={{ href: '/bot', label: 'Bot' }}><KnowledgeGapsPage /></LegacyPage>
}

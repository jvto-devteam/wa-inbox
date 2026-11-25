import type { Metadata } from 'next'
import KnowledgeGapsPage from '@/app/(authenticated)/settings/knowledge-gaps/page'
import { LegacyPage } from '@/components/new/LegacyPage'

export const metadata: Metadata = { title: 'Celah knowledge · New WA Inbox' }

// Halaman /settings/knowledge-gaps apa adanya dengan kulit /new.
export default function Page() {
  return <LegacyPage back={{ href: '/new/bot', label: 'Bot' }}><KnowledgeGapsPage /></LegacyPage>
}

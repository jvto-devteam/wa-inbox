import type { Metadata } from 'next'
import KnowledgeExplorerPage from '@/app/(authenticated)/bot-control/knowledge/page'
import { LegacyPage } from '@/components/new/LegacyPage'

export const metadata: Metadata = { title: 'Knowledge · New WA Inbox' }

// Halaman /bot-control/knowledge apa adanya (kelola, tambah, revisi) dengan kulit /new.
export default function Page() {
  return <LegacyPage back={{ href: '/new/bot', label: 'Bot' }}><KnowledgeExplorerPage /></LegacyPage>
}

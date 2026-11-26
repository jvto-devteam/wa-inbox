import type { Metadata } from 'next'
import DecisionLogsPage from '@/components/legacy-pages/decisions/page'
import { LegacyPage } from '@/components/new/LegacyPage'

export const metadata: Metadata = { title: 'Log keputusan bot · New WA Inbox' }

// Halaman /bot-control/decisions apa adanya (termasuk ?run=<id>) dengan kulit desain baru.
export default function Page() {
  return <LegacyPage back={{ href: '/bot', label: 'Bot' }}><DecisionLogsPage /></LegacyPage>
}

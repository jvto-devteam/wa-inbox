import type { Metadata } from 'next'
import { AgentView } from '@/components/new/views/AgentView'

export const metadata: Metadata = { title: 'Riwayat Agent · New WA Inbox' }

export default function Page() {
  return <AgentView />
}

import type { Metadata } from 'next'
import { InboxView } from '@/components/new/views/InboxView'

export const metadata: Metadata = { title: 'Inbox · New WA Inbox' }

export default function Page() {
  return <InboxView />
}

import type { Metadata } from 'next'
import { HubView } from '@/components/new/views/HubView'

export const metadata: Metadata = { title: 'Dashboard · New WA Inbox' }

export default function Page() {
  return <HubView />
}

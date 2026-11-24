import type { Metadata } from 'next'
import { AntreanView } from '@/components/new/views/AntreanView'

export const metadata: Metadata = { title: 'Antrean · New WA Inbox' }

export default function Page() {
  return <AntreanView />
}

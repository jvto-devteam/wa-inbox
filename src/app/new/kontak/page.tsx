import type { Metadata } from 'next'
import { KontakView } from '@/components/new/views/KontakView'

export const metadata: Metadata = { title: 'Kontak · New WA Inbox' }

export default function Page() {
  return <KontakView />
}

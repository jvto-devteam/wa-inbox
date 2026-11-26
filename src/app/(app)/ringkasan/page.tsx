import type { Metadata } from 'next'
import { RingkasanView } from '@/components/new/views/RingkasanView'

export const metadata: Metadata = { title: 'Ringkasan · New WA Inbox' }

export default function Page() {
  return <RingkasanView />
}

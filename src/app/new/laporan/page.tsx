import type { Metadata } from 'next'
import { LaporanView } from '@/components/new/views/LaporanView'

export const metadata: Metadata = { title: 'Laporan · New WA Inbox' }

export default function Page() {
  return <LaporanView />
}

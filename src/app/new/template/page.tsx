import type { Metadata } from 'next'
import { TemplateView } from '@/components/new/views/TemplateView'

export const metadata: Metadata = { title: 'Template pesan · New WA Inbox' }

export default function Page() {
  return <TemplateView />
}

import type { Metadata } from 'next'
import { BotView } from '@/components/new/views/BotView'

export const metadata: Metadata = { title: 'Bot · New WA Inbox' }

export default function Page() {
  return <BotView />
}

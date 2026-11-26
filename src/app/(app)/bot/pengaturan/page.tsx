import type { Metadata } from 'next'
import ChatbotPage from '@/components/legacy-pages/chatbot/page'
import { LegacyPage } from '@/components/new/LegacyPage'

export const metadata: Metadata = { title: 'Pengaturan bot · New WA Inbox' }

// Halaman /chatbot apa adanya (jam kerja, kalimat cadangan, model LLM, ...) dengan kulit desain baru.
export default function Page() {
  return <LegacyPage back={{ href: '/bot', label: 'Bot' }}><ChatbotPage /></LegacyPage>
}

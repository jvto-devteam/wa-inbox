import { ContactTable } from '@/components/contacts/ContactTable'
import { PageHeader } from '@/components/ui/page-header'

export default function ContactsPage() {
  return (
    <main className="space-y-4 p-6">
      <PageHeader title="Kontak" description="Semua orang yang pernah menghubungi JVTO lewat WhatsApp." />
      <ContactTable />
    </main>
  )
}

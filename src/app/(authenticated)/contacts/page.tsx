import { ContactTable } from '@/components/contacts/ContactTable'
import { PageHeader } from '@/components/ui/page-header'

export default function ContactsPage() {
  return (
    <main className="p-6">
      <PageHeader title="Kontak" className="mb-4" />
      <ContactTable />
    </main>
  )
}

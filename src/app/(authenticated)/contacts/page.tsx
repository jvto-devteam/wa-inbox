import { ContactTable } from '@/components/contacts/ContactTable'

export default function ContactsPage() {
  return (
    <main className="p-6">
      <h1 className="mb-4 text-xl font-semibold text-navy">Kontak</h1>
      <ContactTable />
    </main>
  )
}

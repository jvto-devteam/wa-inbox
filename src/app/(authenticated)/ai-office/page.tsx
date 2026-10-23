import { PageHeader } from '@/components/ui/page-header'
import { AiOffice } from '@/components/ai-office/AiOffice'

export default function AiOfficePage() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4">
      <PageHeader
        title="Kantor AI"
        description="Asisten AI wa-inbox yang sedang bekerja, live dari pesan yang masuk: label topik, balas tamu, ubah booking, dan ringkasan chat."
      />
      <AiOffice />
    </div>
  )
}

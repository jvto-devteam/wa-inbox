import { PageHeader } from '@/components/ui/page-header'
import { AiOffice } from '@/components/ai-office/AiOffice'

export default function AiOfficePage() {
  return (
    <AiOffice
      header={
        <PageHeader
          title="Kantor AI"
          description="Asisten AI wa-inbox yang sedang bekerja, live dari pesan yang masuk: label topik, balas tamu, ubah booking, dan ringkasan chat. Klik asisten untuk mengobrol."
        />
      }
    />
  )
}

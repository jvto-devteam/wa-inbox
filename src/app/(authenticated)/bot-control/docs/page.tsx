'use client'
import Link from 'next/link'
import { DocumentationPreview } from '@/components/bot-control/DocumentationPreview'

export default function DocumentationPage() {
  return (
    <main className="mx-auto max-w-4xl space-y-4 p-6">
      <div className="space-y-1">
        <Link href="/bot-control" className="text-sm text-brand hover:underline">
          &larr; Kembali ke Bot Control
        </Link>
        <h1 className="text-xl font-semibold text-navy">Documentation</h1>
        <p className="text-sm text-muted-foreground">
          Dokumentasi hidup yang dibuat dari kondisi sistem saat ini — flow, aturan, knowledge, template, pengaturan,
          dan gap yang diketahui. Bisa langsung diberikan ke owner atau admin non-developer.
        </p>
        <p className="text-xs text-muted-foreground">
          Dokumen ini tidak pernah memuat token, API key, atau kredensial apa pun — hanya menyebut apakah sebuah
          kapabilitas sudah dikonfigurasi.
        </p>
      </div>

      <DocumentationPreview />
    </main>
  )
}

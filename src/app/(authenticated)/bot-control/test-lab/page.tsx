'use client'
import Link from 'next/link'
import { TestLab, useConversationOptions } from '@/components/bot-control/TestLab'

export default function TestLabPage() {
  const conversations = useConversationOptions()

  return (
    <main className="mx-auto max-w-4xl space-y-4 p-6">
      <div className="space-y-1">
        <Link href="/bot-control" className="text-sm text-brand hover:underline">
          &larr; Kembali ke Bot Control
        </Link>
        <h1 className="text-xl font-semibold text-navy">Test Lab</h1>
        <p className="text-sm text-muted-foreground">
          Menjalankan decision engine yang sebenarnya terhadap sebuah pesan, tanpa mengirim apa pun ke WhatsApp.
        </p>
        {/* Stated up front because it is the guarantee the whole page rests on, and because the
            sandbox detour is otherwise invisible to an operator picking a real conversation. */}
        <p className="text-xs text-muted-foreground">
          Tidak ada pesan yang dikirim, tidak ada outbound job yang dibuat, dan data percakapan asli tidak diubah —
          simulasi selalu berjalan di percakapan sandbox.
        </p>
      </div>

      <TestLab conversations={conversations} />
    </main>
  )
}

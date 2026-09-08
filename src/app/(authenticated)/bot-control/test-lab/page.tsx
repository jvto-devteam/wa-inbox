'use client'
import { TestLab, useConversationOptions } from '@/components/bot-control/TestLab'
import { PageHeader } from '@/components/ui/page-header'

/**
 * The simulator, and only the simulator.
 *
 * There used to be a second tab here holding test cases saved to the database, plus a batch
 * runner behind them. It was removed: nobody ever saved a case, so every run checked nothing
 * and reported PASSED. Regression coverage for the bot lives in `src/lib/bot/eval/`, where the
 * golden cases quote real customer messages and run with `npm run eval`.
 *
 * What remains is the thing this page has always actually been used for: type a message, see
 * what the bot would do, without a single byte reaching WhatsApp.
 */
export default function TestLabPage() {
  const conversations = useConversationOptions()

  return (
    <main className="mx-auto max-w-4xl space-y-4 p-6">
      <PageHeader
        title="Test Lab"
        description={
          <>
            <p>Menjalankan decision engine yang sebenarnya terhadap sebuah pesan, tanpa mengirim apa pun ke WhatsApp.</p>
            {/* Stated up front because it is the guarantee the whole page rests on, and because the
                sandbox detour is otherwise invisible to an operator picking a real conversation. */}
            <p className="mt-1 text-xs">
              Tidak ada pesan yang dikirim, tidak ada outbound job yang dibuat, dan data percakapan asli tidak diubah —
              simulasi selalu berjalan di percakapan sandbox.
            </p>
          </>
        }
      />

      <TestLab conversations={conversations} />
    </main>
  )
}

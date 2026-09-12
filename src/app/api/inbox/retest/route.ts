import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth/get-session'
import { parseJsonBody } from '@/lib/parse-json'
import { runSimulation } from '@/lib/bot-control/simulator'

const bodySchema = z
  .object({
    message: z.string().trim().min(1).max(5000),
    conversationId: z.string().trim().min(1),
  })
  .strict()

/**
 * Uji ulang satu pertanyaan pelanggan setelah knowledge-nya diperbaiki.
 *
 * Terbuka untuk semua yang login, berbeda dari `/api/bot-control/simulate` yang khusus admin:
 * siapa pun yang boleh MENGUBAH jawaban bot (CLAUDE.md §6, pengecualian perbaikan dari Inbox)
 * harus boleh MENGUJINYA, dan menguji adalah tindakan yang lebih aman dari keduanya.
 * `runSimulation` kering -- ia berjalan di percakapan sandbox, mengembalikannya seperti semula,
 * dan dilarang memanggil `sendMessage` atau membuat `OutboundJob` (dijaga test simulator).
 *
 * `useExistingHistory: true`: yang diuji adalah pertanyaan itu DENGAN konteks percakapan
 * aslinya, karena jawaban yang benar untuk pelanggan ini yang sedang diperiksa.
 */
export async function POST(req: Request) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 })

  const parsed = await parseJsonBody(req, bodySchema, 'Data uji ulang tidak valid')
  if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 })

  try {
    const result = await runSimulation({
      message: parsed.data.message,
      conversationId: parsed.data.conversationId,
      useExistingHistory: true,
    })
    return NextResponse.json(result)
  } catch (error) {
    console.error('POST /api/inbox/retest gagal', error)
    return NextResponse.json({ error: 'Gagal menjalankan uji ulang' }, { status: 500 })
  }
}

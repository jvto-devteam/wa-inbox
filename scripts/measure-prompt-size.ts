#!/usr/bin/env tsx
/**
 * Bandingkan panjang prompt nyata terhadap jendela konteks model.
 *
 * READ-ONLY terhadap database. Satu panggilan /api/show ke Ollama (tidak menghasilkan inferensi).
 *
 * Menjawab satu pertanyaan: apakah prompt bot terpotong diam-diam?
 *
 * Gagal keras (exit 1), bukan angka yang menyesatkan, kalau Ollama tidak terjangkau di
 * OLLAMA_URL, atau /api/show sendiri gagal atau membalas non-OK.
 */
import { config } from 'dotenv'

config()

/** Perkiraan kasar: 1 token ~ 4 karakter. Cukup untuk membandingkan orde besaran. */
const estimateTokens = (text: string): number => Math.round(text.length / 4)

async function main() {
  const ollamaUrl = process.env.OLLAMA_URL

  try {
    const ping = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(5000) })
    if (!ping.ok) throw new Error(`status HTTP ${ping.status}`)
  } catch (error) {
    console.error(`Ollama tidak terjangkau di ${ollamaUrl ?? '(OLLAMA_URL tidak diset)'}.`)
    console.error('Pengukuran dibatalkan -- tidak ada query database yang dilakukan.')
    console.error(`Detail: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
    return
  }

  const { prisma } = await import('@/lib/db')

  const settings = await prisma.settings.findFirst({ select: { ollamaModel: true } })
  const model = settings?.ollamaModel ?? 'gemma4:31b-cloud'

  let info: unknown
  try {
    const show = await fetch(`${ollamaUrl}/api/show`, {
      method: 'POST',
      body: JSON.stringify({ model }),
      signal: AbortSignal.timeout(5000),
    })
    if (!show.ok) throw new Error(`status HTTP ${show.status}`)
    info = await show.json()
  } catch (error) {
    console.error(`/api/show gagal untuk model "${model}" di ${ollamaUrl}.`)
    console.error('Pengukuran dibatalkan.')
    console.error(`Detail: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
    await prisma.$disconnect()
    return
  }

  const numCtx = findContextLength(info)

  const runs = await prisma.botDecisionRun.findMany({
    select: { id: true, inboundText: true, replyText: true, trace: true },
    orderBy: { startedAt: 'desc' },
    take: 50,
  })

  const sizes = runs.map((run) => estimateTokens(JSON.stringify(run.trace)))
  sizes.sort((a, b) => a - b)

  console.log(`Model            : ${model}`)
  console.log(`num_ctx model    : ${numCtx ?? 'TIDAK DIKETAHUI -- /api/show tidak melaporkannya'}`)
  console.log(`num_ctx dikirim  : TIDAK (llm.ts tidak mengirim options.num_ctx)`)
  console.log(`Trace token p50  : ${sizes[Math.floor(sizes.length / 2)] ?? 0}`)
  console.log(`Trace token p95  : ${sizes[Math.floor(sizes.length * 0.95)] ?? 0}`)
  console.log(`Trace token maks : ${sizes[sizes.length - 1] ?? 0}`)
  console.log('')
  console.log('CATATAN: trace BUKAN prompt. Ia proksi orde besaran saja.')
  console.log('Angka pasti hanya bisa didapat dengan mencatat panjang system prompt di orchestrator.')
  await prisma.$disconnect()
}

/** Cari nilai context length di respons /api/show, apa pun nama kuncinya. */
function findContextLength(info: unknown): number | null {
  if (typeof info !== 'object' || info === null) return null
  const detail = (info as Record<string, unknown>).model_info
  if (typeof detail !== 'object' || detail === null) return null
  for (const [key, value] of Object.entries(detail)) {
    if (key.endsWith('.context_length') && typeof value === 'number') return value
  }
  return null
}

main().catch((error) => {
  console.error('Gagal:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})

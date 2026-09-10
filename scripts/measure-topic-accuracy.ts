#!/usr/bin/env tsx
/**
 * Ukur akurasi classifyTopicViaLLM terhadap pesan pelanggan sungguhan.
 *
 * READ-ONLY. Tidak ada INSERT/UPDATE/DELETE.
 *
 * Keluarannya TSV ke stdout supaya bisa ditinjau manual: baris mana yang salah, dan ke arah
 * mana. Saat benar-benar dijalankan, arahkan stdout ke file di dalam
 * .superpowers/sdd/2026-09-10-alur-grounding/ (workspace itu gitignored) -- jangan ke /tmp.
 *
 * Angka akurasi ini adalah GERBANG untuk Fase 1 (lihat plan).
 *
 * Gagal keras (exit 1), bukan angka yang menyesatkan, kalau:
 *  - Ollama tidak terjangkau di OLLAMA_URL sebelum pekerjaan apa pun dimulai.
 *  - classifyTopicViaLLM jatuh ke regex_fallback untuk run mana pun -- itu berarti skrip ini
 *    akan mengukur konsistensi regex fallback, bukan classifier LLM produksi.
 *  - Tidak ada satu pun run yang punya topik tercatat di trace untuk dibandingkan.
 */
import { config } from 'dotenv'

config()

async function main() {
  const ollamaUrl = process.env.OLLAMA_URL

  // Diperiksa SEBELUM pekerjaan apa pun (termasuk query database) -- lebih baik berhenti di
  // sini daripada melaporkan angka konsistensi yang sebenarnya mengukur regex fallback.
  try {
    const ping = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(5000) })
    if (!ping.ok) throw new Error(`status HTTP ${ping.status}`)
  } catch (error) {
    console.error(`Ollama tidak terjangkau di ${ollamaUrl ?? '(OLLAMA_URL tidak diset)'}.`)
    console.error('Pengukuran dibatalkan -- tidak ada query database atau panggilan LLM yang dilakukan.')
    console.error(`Detail: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
    return
  }

  const { prisma } = await import('@/lib/db')
  const { classifyTopicViaLLM } = await import('@/lib/bot/topic-classifier')

  const settingsRow = await prisma.settings.findFirst({ select: { ollamaModel: true } })
  const model = settingsRow?.ollamaModel ?? 'gemma4:31b-cloud'

  const limit = Number(process.argv[2] ?? 100)
  const runs = await prisma.botDecisionRun.findMany({
    where: { inboundText: { not: '' } },
    select: { id: true, inboundText: true, trace: true },
    orderBy: { startedAt: 'desc' },
    take: limit,
  })

  console.log(['run_id', 'topik_sekarang', 'topik_ulang', 'cocok', 'pesan'].join('\t'))
  let same = 0
  let compared = 0

  for (const run of runs) {
    const recorded = topicFromTrace(run.trace)
    const again = await classifyTopicViaLLM(null, run.inboundText, model)

    if (again.source === 'regex_fallback') {
      console.error('')
      console.error(`Run ${run.id}: classifyTopicViaLLM jatuh ke regex_fallback, bukan LLM produksi.`)
      console.error('Pengukuran ini akan mengukur konsistensi regex fallback, bukan classifier LLM')
      console.error('produksi. Dibatalkan.')
      process.exitCode = 1
      await prisma.$disconnect()
      return
    }

    if (recorded) {
      compared++
      if (recorded === again.topic) same++
    }
    console.log(
      [
        run.id,
        recorded ?? '-',
        again.topic,
        recorded ? String(recorded === again.topic) : '-',
        run.inboundText.replace(/\s+/g, ' ').slice(0, 80),
      ].join('\t')
    )
  }

  if (compared === 0) {
    console.error('\nTidak ada satu pun run dengan topik tercatat di trace untuk dibandingkan.')
    console.error('compared=0 -- trace.steps tidak berisi langkah bertopik ("topik \\"...\\"") untuk')
    console.error(`${runs.length} run yang diambil, atau tidak ada run yang cocok filter.`)
    process.exitCode = 1
    await prisma.$disconnect()
    return
  }

  console.error(`\nKonsistensi ulang-klasifikasi: ${same}/${compared}`)
  console.error('CATATAN: ini konsistensi, BUKAN kebenaran. Kolom topik_ulang wajib ditinjau manual')
  console.error('terhadap pesannya untuk mendapat akurasi sebenarnya.')
  await prisma.$disconnect()
}

/**
 * Topik yang tercatat di trace run ini, kalau ada.
 *
 * `trace` BUKAN array -- ia objek `BotDecision` yang disanitasi, berbentuk
 * `{ mode, reason, steps: TraceStep[], ... }` (lihat decision-recorder.ts dan
 * src/lib/bot/types.ts). Topiknya muncul di dalam `detail` salah satu step sebagai
 * `topik "<topic>"` (orchestrator.ts).
 */
function topicFromTrace(trace: unknown): string | null {
  if (typeof trace !== 'object' || trace === null) return null
  const steps = (trace as Record<string, unknown>).steps
  if (!Array.isArray(steps)) return null
  for (const step of steps) {
    if (typeof step !== 'object' || step === null) continue
    const detail = (step as Record<string, unknown>).detail
    if (typeof detail !== 'string') continue
    const found = detail.match(/topik "([a-z_]+)"/)
    if (found) return found[1]
  }
  return null
}

main().catch((error) => {
  console.error('Gagal:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})

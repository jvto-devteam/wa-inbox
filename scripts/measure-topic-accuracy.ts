#!/usr/bin/env tsx
/**
 * Ukur akurasi classifyTopicViaLLM terhadap pesan pelanggan sungguhan.
 *
 * READ-ONLY. Tidak ada INSERT/UPDATE/DELETE.
 *
 * Sumber utama (R18): pesan INBOUND asli dari `Message`, bukan `BotDecisionRun`. Sensus
 * produksi 2026-09-10 menunjukkan `BotDecisionRun` hanya berisi 15 baris total (8 dengan
 * topik tercatat, semuanya sejak 2026-09-05) karena `Settings.botAutoReplyAll` sedang false
 * -- delapan baris tidak bisa menopang ambang akurasi apa pun. Akurasi hanya butuh pesan
 * pelanggan asli + jawaban classifier + label manusia, jadi sampelnya pindah ke pesan masuk
 * yang benar-benar jadi audiens bot (nomor non-Indonesia). Perbandingan trace
 * `BotDecisionRun` lama tetap ada di bawah sebagai info sekunder, bukan gerbang.
 *
 * Keluarannya TSV ke stdout supaya bisa ditinjau manual: baris mana yang salah, dan ke arah
 * mana. Saat benar-benar dijalankan, arahkan stdout ke file di dalam
 * .superpowers/sdd/2026-09-10-alur-grounding/ (workspace itu gitignored) -- jangan ke /tmp.
 *
 * Angka akurasi ini adalah GERBANG untuk Fase 1 (lihat plan).
 *
 * Gagal keras (exit 1), bukan angka yang menyesatkan, kalau:
 *  - Ollama tidak terjangkau di OLLAMA_URL sebelum pekerjaan apa pun dimulai.
 *  - classifyTopicViaLLM jatuh ke regex_fallback untuk pesan mana pun di sampel UTAMA -- itu
 *    berarti skrip ini akan mengukur regex fallback, bukan classifier LLM produksi.
 *  - Tidak ada satu pun pesan masuk yang memenuhi syarat (non-Indonesia, berteks) untuk
 *    disampel.
 */
import { config } from 'dotenv'

// `quiet: true` -- stdout di skrip ini adalah TSV yang dibaca mesin (lihat header file).
// Tanpa ini, dotenv v17 sendiri mencetak baris "◇ injected env ..." ke stdout SEBELUM baris
// header TSV, jadi setiap konsumen TSV harus tahu untuk membuang baris pertama secara manual.
// Task 2 dan 3 sengaja TIDAK diubah -- stdout keduanya dibaca manusia, bukan diparse.
config({ quiet: true })

/** Sampel harus reproducible supaya angka akurasi bisa dibandingkan lintas waktu tanpa
 * "kebetulan dapat sampel mudah/susah" -- karena itu shuffle-nya diberi seed tetap. */
const SAMPLE_SEED = 20260910

type EligibleMessage = { id: string; content: string }

async function main() {
  const ollamaUrl = process.env.OLLAMA_URL

  // Diperiksa SEBELUM pekerjaan apa pun (termasuk query database) -- lebih baik berhenti di
  // sini daripada melaporkan angka akurasi yang sebenarnya mengukur regex fallback.
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
  const { isIndonesianNumber } = await import('@/lib/phone')

  const settingsRow = await prisma.settings.findFirst({ select: { ollamaModel: true } })
  const model = settingsRow?.ollamaModel ?? 'gemma4:31b-cloud'

  // --- Sampel utama: pesan INBOUND asli, bukan BotDecisionRun. ---
  const messages = await prisma.message.findMany({
    where: { direction: 'INBOUND', content: { not: null } },
    select: {
      id: true,
      content: true,
      conversation: { select: { contact: { select: { phone: true } } } },
    },
    orderBy: { createdAt: 'desc' },
    take: 3000,
  })

  const eligible: EligibleMessage[] = []
  for (const message of messages) {
    if (typeof message.content !== 'string') continue
    const text = message.content.trim()
    if (!text) continue
    if (isIndonesianNumber(message.conversation.contact.phone)) continue
    eligible.push({ id: message.id, content: message.content })
  }

  if (eligible.length === 0) {
    console.error('Tidak ada satu pun pesan masuk yang memenuhi syarat (non-Indonesia, berteks)')
    console.error(`dari ${messages.length} pesan INBOUND terakhir. Pengukuran dibatalkan.`)
    process.exitCode = 1
    await prisma.$disconnect()
    return
  }

  const limit = Number(process.argv[2] ?? 100)
  const sampled = seededShuffle(eligible, SAMPLE_SEED).slice(0, limit)

  console.log(['message_id', 'topik', 'pesan'].join('\t'))
  const topicCounts: Record<string, number> = {}

  for (const message of sampled) {
    const result = await classifyTopicViaLLM(null, message.content, model)

    if (result.source === 'regex_fallback') {
      console.error('')
      console.error(`Pesan ${message.id}: classifyTopicViaLLM jatuh ke regex_fallback, bukan LLM produksi.`)
      console.error('Pengukuran ini akan mengukur regex fallback, bukan classifier LLM produksi.')
      console.error('Dibatalkan.')
      process.exitCode = 1
      await prisma.$disconnect()
      return
    }

    topicCounts[result.topic] = (topicCounts[result.topic] ?? 0) + 1
    console.log([message.id, result.topic, message.content.replace(/\s+/g, ' ').slice(0, 80)].join('\t'))
  }

  console.error(`\nPesan masuk memenuhi syarat (non-Indonesia, berteks): ${eligible.length}`)
  console.error(`Disampel (seed ${SAMPLE_SEED}): ${sampled.length}`)
  console.error('Distribusi topik pada sampel:')
  for (const [topic, count] of Object.entries(topicCounts).sort((a, b) => b[1] - a[1])) {
    console.error(`  ${topic.padEnd(24)} ${count}`)
  }
  console.error('\nTinjau kolom `pesan` di TSV di atas terhadap `topik` secara manual untuk mendapat akurasi')
  console.error('sebenarnya -- tidak ada label kebenaran di database.')

  // --- Sekunder, informasi saja: konsistensi trace BotDecisionRun lama vs reklasifikasi. ---
  // Didemosi dari pengukuran utama (R18): sensus produksi menunjukkan hanya 15 baris
  // BotDecisionRun total ada, jadi ini TIDAK PERNAH menghentikan apa pun lagi -- sekadar
  // konteks tambahan kalau kebetulan ada baris untuk dibandingkan.
  const runs = await prisma.botDecisionRun.findMany({
    where: { inboundText: { not: '' } },
    select: { id: true, inboundText: true, trace: true },
    orderBy: { startedAt: 'desc' },
    take: 300,
  })

  let same = 0
  let compared = 0
  let fallbackSkipped = 0
  for (const run of runs) {
    const recorded = topicFromTrace(run.trace)
    const again = await classifyTopicViaLLM(null, run.inboundText, model)
    // Blok ini informasional, jadi tidak berhenti keras di regex_fallback seperti blok
    // utama -- tapi baris begini TETAP tidak boleh ikut dihitung: "LLM vs LLM" tidak boleh
    // diam-diam kemasukan topik hasil regex kalau Ollama sempat degradasi di tengah run.
    if (again.source === 'regex_fallback') {
      fallbackSkipped++
      continue
    }
    if (recorded) {
      compared++
      if (recorded === again.topic) same++
    }
  }

  console.error(`\n[Sekunder, informasi saja] Konsistensi trace BotDecisionRun: ${same}/${compared}`)
  console.error(`dibandingkan (dari ${runs.length} run BotDecisionRun yang diambil).`)
  console.error(`${fallbackSkipped} baris dilewati karena regex_fallback -- tidak dihitung.`)
  console.error('CATATAN: sampel BotDecisionRun sangat kecil di produksi (lihat komentar kepala file) --')
  console.error('ini bukan gerbang, dan compared=0 di sini TIDAK mengubah kode keluar skrip ini.')

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

/**
 * mulberry32 -- PRNG kecil dan deterministik. Dipakai (bukan Math.random) supaya sampel
 * "acak" ini tetap sama persis di setiap run: angka akurasi harus reproducible untuk bisa
 * dibandingkan lintas waktu, bukan bergantung pada sampel yang kebetulan berbeda tiap kali.
 */
function mulberry32(seed: number): () => number {
  let state = seed
  return function random(): number {
    state |= 0
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Fisher-Yates dengan PRNG seeded -- lihat mulberry32 di atas. */
function seededShuffle<T>(items: T[], seed: number): T[] {
  const random = mulberry32(seed)
  const copy = items.slice()
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

main().catch((error) => {
  console.error('Gagal:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})

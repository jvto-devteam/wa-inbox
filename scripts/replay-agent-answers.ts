#!/usr/bin/env tsx
/**
 * Replay pertanyaan pembuka pelanggan asli ke bot, berdampingan dengan jawaban admin JVTO yang
 * benar-benar terkirim. Jawaban admin adalah sumber kebenaran; selisihnya menunjukkan celah
 * knowledge atau alur. Aturan pemilihan pasangan ada di src/lib/bot/eval/replay-pairs.ts.
 *
 * Dijalankan BERTAHAP atas permintaan operator (2026-09-15): batch kecil dulu, ditinjau, baru
 * dinaikkan. Pasangan yang sudah ditinjau dikecualikan lewat `--exclude` (id percakapan, dipisah
 * koma) -- bukan lewat offset, karena setiap perubahan aturan pemilihan mengubah urutan acaknya:
 *   tahap 1: --limit 10
 *   tahap 2: --limit 50 --exclude <10 id tahap 1>
 *
 * Harus dijalankan DI VPS. Di laptop, gerbang deployment tertutup (catalog/deployment-approval.json
 * hanya ada di VPS) dan setiap giliran jatuh ke handoff yang tidak berkata apa pun tentang
 * produksi. Skrip berhenti dengan kode 3 kalau gerbang tertutup, sama seperti run-eval.ts.
 *
 * Tulisan ke database, dan hanya ini:
 *  - satu Contact + Conversation sekali pakai per percobaan (telepon `replay-...`, isTest=true,
 *    botEnabled=false), disapu begitu percobaannya selesai dan juga di awal run. isTest mematikan
 *    lookup booking (ensureFreshBookingData), sehingga booking yang dibuat pelanggan SESUDAH
 *    pertanyaan itu tidak bocor ke jawaban replay.
 *  - decideAndRespond dijalankan dengan `options.draft`: tripBrief tidak ditulis, dan gap knowledge
 *    dikumpulkan di memori (ikut dilaporkan) alih-alih ditulis ke KnowledgeGapLog.
 * Tidak ada Message yang dibuat, dan sendMessage tidak diimpor: tidak ada yang terkirim ke siapa pun.
 *
 * Giliran yang jatuh ke jalur cadangan (classifier LLM timeout, jawaban kosong -- lihat
 * degradedReason) diulang sekali. Kalau masih jatuh, barisnya ditandai `degraded` dan tidak boleh
 * dinilai: ia mengukur gangguan, bukan knowledge.
 *
 * Keluaran: satu baris JSON per pasangan ke stdout, ringkasan ke stderr. stdout berisi teks
 * pelanggan -- simpan di luar repo. Teks pelanggan dikirim ke model di Settings.ollamaModel, sama
 * seperti giliran bot produksi.
 *
 * Kode keluar: 0 selesai, 1 ada percobaan yang melempar atau batch kosong, 3 gerbang tertutup.
 */
import { config } from 'dotenv'
import type { BotDecision } from '@/lib/bot/types'
import type { PendingKnowledgeGap } from '@/lib/bot/orchestrator'
import type { OpeningPair } from '@/lib/bot/eval/replay-pairs'

// `quiet: true`: stdout skrip ini adalah JSONL yang dibaca mesin.
config({ quiet: true })

const EXIT_GATE_CLOSED = 3
const SAMPLE_SEED = 20260915
const MAX_ATTEMPTS = 2

function readNumberFlag(name: string, fallback: number): number {
  const index = process.argv.indexOf(`--${name}`)
  if (index === -1) return fallback
  const value = Number(process.argv[index + 1])
  if (!Number.isInteger(value) || value < 0) throw new Error(`--${name} harus bilangan bulat >= 0`)
  return value
}

function readListFlag(name: string): Set<string> {
  const index = process.argv.indexOf(`--${name}`)
  if (index === -1) return new Set()
  const raw = process.argv[index + 1]
  if (!raw || raw.startsWith('--')) throw new Error(`--${name} butuh daftar id dipisah koma`)
  return new Set(raw.split(',').map((id) => id.trim()).filter(Boolean))
}

function decisionSummary(decision: BotDecision | null) {
  if (!decision) return null
  return {
    mode: decision.mode,
    reason: decision.mode === 'handoff' ? decision.reason : null,
    sourceTopic: decision.mode === 'faq' ? decision.sourceTopic : null,
    topic: 'topic' in decision ? (decision.topic ?? null) : null,
    job: 'job' in decision ? (decision.job ?? null) : null,
    verification: decision.verification ?? null,
    steps: decision.steps ?? [],
  }
}

async function main(): Promise<void> {
  const offset = readNumberFlag('offset', 0)
  const limit = readNumberFlag('limit', 10)
  const exclude = readListFlag('exclude')

  // Dynamic import: modul-modul ini membaca env saat dimuat, jadi harus sesudah dotenv.
  const { checkDeploymentGate } = await import('@/lib/bot/deployment-gate')
  const gate = checkDeploymentGate()
  if (!gate.readyForApproval) {
    console.error('Gerbang deployment TERTUTUP -- replay dibatalkan, setiap giliran akan jatuh ke handoff palsu.')
    for (const reason of gate.blocking) console.error(`  - ${reason}`)
    console.error('Jalankan skrip ini di VPS, tempat catalog/deployment-approval.json berada.')
    process.exitCode = EXIT_GATE_CLOSED
    return
  }

  const ollamaUrl = process.env.OLLAMA_URL
  try {
    const ping = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(5000) })
    if (!ping.ok) throw new Error(`status HTTP ${ping.status}`)
  } catch (error) {
    console.error(`Ollama tidak terjangkau di ${ollamaUrl ?? '(OLLAMA_URL tidak diset)'} -- replay dibatalkan.`)
    console.error(`Detail: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
    return
  }

  const { prisma } = await import('@/lib/db')
  const { decideAndRespond } = await import('@/lib/bot/orchestrator')
  const { replyFromDecision } = await import('@/lib/bot-control/simulator')
  const { isIndonesianNumber } = await import('@/lib/phone')
  const { BURST_DEBOUNCE_MS, BURST_MAX_WAIT_MS } = await import('@/lib/inbound')
  const pairs = await import('@/lib/bot/eval/replay-pairs')

  try {
    const broadcastRows = await prisma.$queryRaw<{ content: string }[]>`
      SELECT content FROM "Message"
      WHERE "sentBy" = 'AGENT' AND content IS NOT NULL AND content <> ''
      GROUP BY content
      HAVING count(DISTINCT "conversationId") >= ${pairs.BROADCAST_MIN_CONVERSATIONS}`
    const broadcastContents = new Set(broadcastRows.map((row) => row.content))

    const conversations = await prisma.conversation.findMany({
      where: { isTest: false },
      select: {
        id: true,
        bookingData: true,
        contact: { select: { phone: true } },
        messages: { select: { id: true, sentBy: true, type: true, content: true, createdAt: true } },
      },
    })

    const skipped: Record<string, number> = {}
    const skip = (reason: string) => {
      skipped[reason] = (skipped[reason] ?? 0) + 1
    }
    const eligible: OpeningPair[] = []
    for (const conversation of conversations) {
      if (exclude.has(conversation.id)) {
        skip('sudah_ditinjau')
        continue
      }
      // Audiens bot: nomor non-Indonesia (Settings.skipBotForIndonesianNumbers).
      if (isIndonesianNumber(conversation.contact.phone)) {
        skip('nomor_indonesia')
        continue
      }
      const booking = conversation.bookingData as { booking_date?: unknown } | null
      const result = pairs.buildOpeningPair(
        conversation.id,
        conversation.messages,
        { broadcastContents, burstDebounceMs: BURST_DEBOUNCE_MS, burstMaxWaitMs: BURST_MAX_WAIT_MS },
        pairs.parseBookingDay(booking?.booking_date)
      )
      if (result.ok) eligible.push(result.pair)
      else skip(result.reason)
    }

    // Diurutkan dulu supaya urutan acak tidak bergantung pada urutan baris dari Postgres.
    eligible.sort((a, b) => a.askedAt.getTime() - b.askedAt.getTime() || a.conversationId.localeCompare(b.conversationId))
    const batch = pairs.seededShuffle(eligible, SAMPLE_SEED).slice(offset, offset + limit)

    const unmatchedExcludes = [...exclude].filter((id) => !conversations.some((c) => c.id === id))
    console.error(`Percakapan non-test: ${conversations.length}`)
    for (const [reason, count] of Object.entries(skipped).sort((a, b) => b[1] - a[1])) {
      console.error(`  dilewati ${reason.padEnd(44)} ${count}`)
    }
    if (unmatchedExcludes.length > 0) console.error(`  PERINGATAN: ${unmatchedExcludes.length} id --exclude tidak ditemukan`)
    console.error(`Pasangan pembuka memenuhi syarat: ${eligible.length}`)
    console.error(`Batch (seed ${SAMPLE_SEED}): urutan ${offset}..${offset + batch.length - 1} (${batch.length} pasangan)\n`)

    if (batch.length === 0) {
      console.error('Batch kosong -- offset melewati jumlah pasangan yang memenuhi syarat.')
      process.exitCode = 1
      return
    }

    await pairs.sweepReplayRows(prisma)

    const modeCounts: Record<string, number> = {}
    let failures = 0
    let degradedCount = 0
    for (const [position, pair] of batch.entries()) {
      const startedAt = Date.now()
      let decision: BotDecision | null = null
      let knowledgeGaps: PendingKnowledgeGap[] = []
      let error: string | null = null
      let degraded: string | null = null
      let attempts = 0

      while (attempts < MAX_ATTEMPTS) {
        attempts++
        decision = null
        error = null
        knowledgeGaps = []
        try {
          const contact = await prisma.contact.create({
            data: { phone: `${pairs.REPLAY_PHONE_PREFIX}${pair.conversationId}`, name: 'replay' },
          })
          const conversation = await prisma.conversation.create({
            data: { contactId: contact.id, isTest: true, botEnabled: false, tripBrief: {} },
          })
          decision = await decideAndRespond(conversation.id, pair.customerText, undefined, {
            draft: { historyBefore: new Date(), knowledgeGaps },
          })
        } catch (caught) {
          error = caught instanceof Error ? caught.message : String(caught)
        } finally {
          await pairs.sweepReplayRows(prisma)
        }
        degraded = error ? null : pairs.degradedReason(decision?.steps ?? [])
        if (!error && !degraded) break
      }

      if (error) failures++
      if (degraded) degradedCount++
      const mode = error ? 'gagal' : degraded ? 'degraded' : (decision?.mode ?? 'gagal')
      modeCounts[mode] = (modeCounts[mode] ?? 0) + 1
      console.error(
        `[${offset + position}] ${mode.padEnd(16)} ${Math.round((Date.now() - startedAt) / 1000)}s  percobaan ${attempts}  ${pair.conversationId}`
      )
      console.log(
        JSON.stringify({
          urutan: offset + position,
          conversationId: pair.conversationId,
          askedAt: pair.askedAt,
          productionBurstCount: pair.productionBurstCount,
          customer: pair.customerText,
          admin: pair.adminText,
          adminMediaCount: pair.adminMediaCount,
          bot: { reply: replyFromDecision(decision), ...decisionSummary(decision), knowledgeGaps },
          attempts,
          degraded,
          error,
          latencyMs: Date.now() - startedAt,
        })
      )
    }

    console.error('\nHasil (degraded dan gagal tidak boleh dinilai):')
    for (const [mode, count] of Object.entries(modeCounts).sort((a, b) => b[1] - a[1])) {
      console.error(`  ${mode.padEnd(16)} ${count}`)
    }
    if (degradedCount > 0) console.error(`${degradedCount} pasangan tetap degraded setelah ${MAX_ATTEMPTS} percobaan.`)
    if (failures > 0) {
      console.error(`${failures} pasangan gagal dijalankan (lihat kolom error).`)
      process.exitCode = 1
    }
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error('Replay gagal:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})

#!/usr/bin/env tsx
/**
 * Nilai untuk tiap balasan bot: apa yang pelanggan tulis SETELAHNYA.
 *
 * READ-ONLY.
 *
 * Ini satu-satunya ukuran kebenaran jawaban yang datanya sudah tersedia hari ini.
 * Klasifikasinya sengaja kasar dan berbasis kata -- tujuannya orde besaran, bukan presisi.
 */
import { config } from 'dotenv'

config()

type Verdict = 'mengulang' | 'mengoreksi' | 'lanjut' | 'tidak_ada_respons'

const CORRECTION_MARKERS = ['no,', 'no i mean', 'i meant', 'not that', 'bukan itu', 'maksud saya']

async function main() {
  const { prisma } = await import('@/lib/db')

  const runs = await prisma.botDecisionRun.findMany({
    where: { status: 'REPLIED' },
    select: { id: true, conversationId: true, inboundText: true, finishedAt: true },
    orderBy: { startedAt: 'desc' },
    take: 300,
  })

  const tally: Record<Verdict, number> = {
    mengulang: 0,
    mengoreksi: 0,
    lanjut: 0,
    tidak_ada_respons: 0,
  }

  for (const run of runs) {
    if (!run.finishedAt) continue
    const next = await prisma.message.findFirst({
      where: {
        conversationId: run.conversationId,
        direction: 'INBOUND',
        createdAt: { gt: run.finishedAt },
      },
      select: { content: true },
      orderBy: { createdAt: 'asc' },
    })
    tally[verdictFor(run.inboundText, next?.content ?? null)]++
  }

  const total = Object.values(tally).reduce((sum, n) => sum + n, 0)
  console.log(`Dari ${total} balasan bot:\n`)
  for (const [name, count] of Object.entries(tally)) {
    const pct = total ? ((count / total) * 100).toFixed(1) : '0.0'
    console.log(`  ${name.padEnd(18)} ${String(count).padStart(4)}  ${pct}%`)
  }
  console.log('\n"mengulang" dan "mengoreksi" adalah kandidat jawaban GAGAL.')
  await prisma.$disconnect()
}

/** Seberapa mirip pesan berikutnya dengan pesan sebelumnya -- proksi kasar untuk "diulang". */
function verdictFor(previous: string, next: string | null): Verdict {
  if (!next) return 'tidak_ada_respons'
  const low = next.toLowerCase()
  if (CORRECTION_MARKERS.some((marker) => low.includes(marker))) return 'mengoreksi'
  if (overlapRatio(previous, next) >= 0.6) return 'mengulang'
  return 'lanjut'
}

/** Rasio kata (>=4 huruf) pesan lama yang muncul lagi di pesan baru. */
function overlapRatio(a: string, b: string): number {
  const words = (text: string) =>
    new Set(text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4))
  const before = words(a)
  if (before.size === 0) return 0
  const after = words(b)
  let hits = 0
  for (const word of before) if (after.has(word)) hits++
  return hits / before.size
}

main().catch((error) => {
  console.error('Gagal:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})

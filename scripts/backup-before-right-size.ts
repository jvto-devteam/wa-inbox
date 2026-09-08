/**
 * Cadangan READ-ONLY sebelum migrasi destruktif right-sizing Bot Control.
 *
 * Menulis isi setiap tabel yang akan di-DROP ke satu file JSON. Skrip ini tidak
 * mengubah apa pun di database.
 *
 * KnowledgeChunk (502 baris) SENGAJA tidak ikut: isinya turunan dari catalog/*.json
 * yang sudah ada di repo, jadi mencadangkannya berarti menyalin data yang sumbernya
 * sudah versioned. Jumlah barisnya tetap dicatat supaya bisa dibandingkan.
 */
import { config } from 'dotenv'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

config()

type Db = typeof import('@/lib/db')['prisma']
let prisma: Db

const TABLES = [
  'BotRelease',
  'BotRuleSetting',
  'BotFlowDefinition',
  'BotFlowVersion',
  'BotTestCase',
  'BotTestRun',
  'BotTestResult',
  'BotDecisionTriage',
  'ChannelPolicySetting',
  'KnowledgeSource',
  'KnowledgeRevision',
  'BotControlAuditLog',
] as const

async function main() {
  prisma = (await import('@/lib/db')).prisma
  const out = process.argv[2]
  if (!out) throw new Error('Pakai: tsx scripts/backup-before-right-size.ts <path-file-json>')

  const dump: Record<string, unknown> = {
    _catatan: 'Cadangan sebelum migrasi destruktif right-sizing Bot Control.',
    _dibuat: new Date().toISOString(),
  }

  for (const table of TABLES) {
    const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(`SELECT * FROM "${table}"`)
    dump[table] = rows
    console.log(`${table}: ${rows.length} baris`)
  }

  const [{ baris }] = await prisma.$queryRawUnsafe<{ baris: number }[]>(
    `SELECT COUNT(*)::int AS baris FROM "KnowledgeChunk"`,
  )
  dump._KnowledgeChunk_jumlah_saja = baris
  console.log(`KnowledgeChunk: ${baris} baris (tidak ikut dicadangkan — turunan catalog/*.json)`)

  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify(dump, (_k, v) => (typeof v === 'bigint' ? Number(v) : v), 2))
  console.log(`\nDitulis ke ${out}`)
}

main()
  .catch((error) => {
    console.error('FATAL:', error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => prisma?.$disconnect())

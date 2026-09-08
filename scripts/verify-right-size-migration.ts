/**
 * Verifikasi READ-ONLY sebelum migrasi right-sizing Bot Control.
 *
 * Menjawab dua jebakan di docs/right-size-migration/RUNBOOK.md dengan data produksi
 * yang sebenarnya, plus menghitung isi setiap tabel yang akan di-DROP.
 *
 * Skrip ini HANYA membaca. Tidak ada INSERT/UPDATE/DELETE/ALTER di sini.
 */
import { config } from 'dotenv'

// tsx tidak memuat .env sendiri seperti Next.js. Konvensi yang sama dipakai prisma.config.ts.
config()

// Diimpor di dalam main() karena @/lib/db membaca DATABASE_URL saat modul dimuat —
// config() di atas harus sudah jalan lebih dulu.
type Db = typeof import('@/lib/db')['prisma']
let prisma: Db

type Row = Record<string, unknown>

async function q(label: string, sql: string): Promise<Row[]> {
  try {
    const rows = await prisma.$queryRawUnsafe<Row[]>(sql)
    console.log(`\n--- ${label} ---`)
    console.log(JSON.stringify(rows, (_k, v) => (typeof v === 'bigint' ? Number(v) : v), 2))
    return rows
  } catch (error) {
    console.log(`\n--- ${label} ---`)
    console.log('GAGAL:', error instanceof Error ? `${error.name}: ${error.message}` : String(error))
    if (error instanceof Error && 'cause' in error) console.log('  cause:', String(error.cause))
    return []
  }
}

async function main() {
  prisma = (await import('@/lib/db')).prisma
  console.log('=== VERIFIKASI READ-ONLY: right-sizing Bot Control ===')

  await q(
    'JEBAKAN 1 — channel default',
    `SELECT s."defaultChannel" AS settings_default,
            c."defaultOutbound" AS policy_default,
            (s."defaultChannel"::text IS DISTINCT FROM c."defaultOutbound") AS default_channel_berubah
       FROM "Settings" s
       LEFT JOIN "ChannelPolicySetting" c ON c."key" = 'default'`,
  )

  await q(
    'JEBAKAN 2 — sakelar nomor Indonesia (harus di-OR, bukan disalin)',
    `SELECT s."skipBotForIndonesianNumbers" AS settings_toggle,
            r."enabled"                      AS rule_enabled,
            (s."skipBotForIndonesianNumbers" OR COALESCE(r."enabled", false)) AS nilai_setelah_migrasi
       FROM "Settings" s
       LEFT JOIN "BotRuleSetting" r ON r."key" = 'bot.skip_indonesian_numbers'`,
  )

  await q(
    'Rule handoff_on_human_request',
    `SELECT "key", "enabled", "status" FROM "BotRuleSetting" WHERE "key" = 'bot.handoff_on_human_request'`,
  )

  await q(
    'ChannelPolicySetting — baris apa adanya (key tidak diasumsikan)',
    `SELECT "key", "status", "defaultOutbound", "pausedProviders", "safetyConfig", "capabilityRules"
       FROM "ChannelPolicySetting"`,
  )

  await q(
    'Kolom yang benar-benar ada di BotFlowVersion',
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'BotFlowVersion' ORDER BY ordinal_position`,
  )

  await q(
    'BotFlowDefinition — baris apa adanya',
    `SELECT * FROM "BotFlowDefinition"`,
  )

  await q(
    'Jumlah baris tiap tabel yang akan di-DROP',
    `SELECT 'BotRelease' AS tabel, COUNT(*)::int AS baris FROM "BotRelease"
     UNION ALL SELECT 'BotRuleSetting', COUNT(*)::int FROM "BotRuleSetting"
     UNION ALL SELECT 'BotFlowDefinition', COUNT(*)::int FROM "BotFlowDefinition"
     UNION ALL SELECT 'BotFlowVersion', COUNT(*)::int FROM "BotFlowVersion"
     UNION ALL SELECT 'BotTestCase', COUNT(*)::int FROM "BotTestCase"
     UNION ALL SELECT 'BotTestRun', COUNT(*)::int FROM "BotTestRun"
     UNION ALL SELECT 'BotTestResult', COUNT(*)::int FROM "BotTestResult"
     UNION ALL SELECT 'BotDecisionTriage', COUNT(*)::int FROM "BotDecisionTriage"
     UNION ALL SELECT 'ChannelPolicySetting', COUNT(*)::int FROM "ChannelPolicySetting"
     UNION ALL SELECT 'KnowledgeChunk', COUNT(*)::int FROM "KnowledgeChunk"
     UNION ALL SELECT 'KnowledgeRevision', COUNT(*)::int FROM "KnowledgeRevision"
     UNION ALL SELECT 'BotControlAuditLog', COUNT(*)::int FROM "BotControlAuditLog"
     ORDER BY 1`,
  )

  await q(
    'Baris audit yang punya before/after (hilang permanen saat DROP COLUMN)',
    `SELECT COUNT(*)::int AS baris_dengan_diff
       FROM "BotControlAuditLog"
      WHERE "before" IS NOT NULL OR "after" IS NOT NULL`,
  )

  await q(
    'KnowledgeSource per tipe (pengaman: MANUAL tidak boleh ikut terhapus)',
    `SELECT "type", COUNT(*)::int AS baris FROM "KnowledgeSource" GROUP BY "type" ORDER BY 1`,
  )

  await q(
    'Migrasi yang sudah diterapkan (3 terakhir)',
    `SELECT migration_name, finished_at IS NOT NULL AS selesai
       FROM "_prisma_migrations" ORDER BY started_at DESC LIMIT 3`,
  )
}

main()
  .catch((error) => {
    console.error('FATAL:', error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => prisma?.$disconnect())

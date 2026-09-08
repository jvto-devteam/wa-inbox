/**
 * Verifikasi READ-ONLY setelah migrasi destruktif right-sizing.
 *
 * Memastikan 10 tabel benar-benar hilang, kolom yang dipertahankan masih ada,
 * dan tidak ada data yang seharusnya bertahan ikut terbawa. Tidak mengubah apa pun.
 */
import { config } from 'dotenv'

config()

type Db = typeof import('@/lib/db')['prisma']
let prisma: Db

const HARUS_HILANG = [
  'BotRelease',
  'BotRuleSetting',
  'BotFlowDefinition',
  'BotFlowVersion',
  'BotTestCase',
  'BotTestRun',
  'BotTestResult',
  'BotDecisionTriage',
  'ChannelPolicySetting',
  'KnowledgeChunk',
]

const HARUS_ADA = [
  'Settings',
  'BotDecisionRun',
  'BotControlAuditLog',
  'KnowledgeSource',
  'KnowledgeRevision',
  'KnowledgeGapLog',
  'OutboundJob',
  'Conversation',
  'Message',
  'Contact',
]

async function main() {
  prisma = (await import('@/lib/db')).prisma

  const ada = await prisma.$queryRawUnsafe<{ table_name: string }[]>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
  )
  const nama = new Set(ada.map((r) => r.table_name))

  const masihAda = HARUS_HILANG.filter((t) => nama.has(t))
  const hilang = HARUS_ADA.filter((t) => !nama.has(t))

  console.log('--- 10 tabel yang harus hilang ---')
  console.log(masihAda.length === 0 ? 'OK: semuanya sudah hilang' : `GAGAL masih ada: ${masihAda.join(', ')}`)

  console.log('\n--- tabel inti yang harus tetap ada ---')
  console.log(hilang.length === 0 ? 'OK: semuanya masih ada' : `GAGAL hilang: ${hilang.join(', ')}`)

  const kolomAudit = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'BotControlAuditLog' ORDER BY ordinal_position`,
  )
  console.log('\n--- kolom BotControlAuditLog (harus 5 inti, tanpa before/after/ipAddress/userAgent) ---')
  console.log(kolomAudit.map((c) => c.column_name).join(', '))

  const kolomRun = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'BotDecisionRun' AND column_name IN ('steps','flaggedAt','flagNote')
      ORDER BY column_name`,
  )
  console.log('\n--- kolom baru BotDecisionRun ---')
  console.log(kolomRun.map((c) => c.column_name).join(', ') || 'TIDAK ADA')

  const settings = await prisma.settings.findUnique({ where: { id: 1 } })
  console.log('\n--- Settings (sumber kebenaran tunggal sekarang) ---')
  console.log(
    JSON.stringify(
      {
        defaultChannel: settings?.defaultChannel,
        skipBotForIndonesianNumbers: settings?.skipBotForIndonesianNumbers,
        handoffOnHumanRequest: settings?.handoffOnHumanRequest,
        campaignRatePerMinute: settings?.campaignRatePerMinute,
        duplicateWindowMs: settings?.duplicateWindowMs,
        providerFailureThreshold: settings?.providerFailureThreshold,
        providerFailureWindowMs: settings?.providerFailureWindowMs,
        pausedProviders: settings?.pausedProviders,
      },
      null,
      2,
    ),
  )

  const jumlah = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT 'BotDecisionRun' AS tabel, COUNT(*)::int AS baris FROM "BotDecisionRun"
     UNION ALL SELECT 'BotControlAuditLog', COUNT(*)::int FROM "BotControlAuditLog"
     UNION ALL SELECT 'KnowledgeSource', COUNT(*)::int FROM "KnowledgeSource"
     UNION ALL SELECT 'Conversation', COUNT(*)::int FROM "Conversation"
     UNION ALL SELECT 'Message', COUNT(*)::int FROM "Message"
     UNION ALL SELECT 'OutboundJob', COUNT(*)::int FROM "OutboundJob"
     ORDER BY 1`,
  )
  console.log('\n--- jumlah baris data yang bertahan ---')
  console.log(JSON.stringify(jumlah, null, 2))
}

main()
  .catch((error) => {
    console.error('FATAL:', error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => prisma?.$disconnect())

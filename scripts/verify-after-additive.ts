/**
 * Verifikasi READ-ONLY setelah migrasi aditif right-sizing Bot Control.
 *
 * Memastikan sepuluh kolom baru ada dan berisi nilai yang benar SEBELUM migrasi
 * destruktif dijalankan. Tidak mengubah apa pun.
 */
import { config } from 'dotenv'

config()

type Db = typeof import('@/lib/db')['prisma']
let prisma: Db

async function main() {
  prisma = (await import('@/lib/db')).prisma

  const settings = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT "defaultChannel", "skipBotForIndonesianNumbers", "handoffOnHumanRequest",
            "fallbackReply", "handoffReply", "campaignRatePerMinute", "duplicateWindowMs",
            "providerFailureThreshold", "providerFailureWindowMs", "pausedProviders",
            "workingHoursStart", "workingHoursEnd", "offHoursAutoReply"
       FROM "Settings" WHERE id = 1`,
  )
  console.log('--- Settings setelah migrasi aditif ---')
  console.log(JSON.stringify(settings, null, 2))

  const decision = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT column_name, data_type FROM information_schema.columns
      WHERE table_name = 'BotDecisionRun' AND column_name IN ('flaggedAt', 'flagNote')
      ORDER BY column_name`,
  )
  console.log('\n--- Kolom baru di BotDecisionRun ---')
  console.log(JSON.stringify(decision, null, 2))

  const idx = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT indexname FROM pg_indexes
      WHERE tablename = 'BotDecisionRun' AND indexname = 'BotDecisionRun_flaggedAt_idx'`,
  )
  console.log('\n--- Index flaggedAt ---')
  console.log(JSON.stringify(idx, null, 2))

  const banding = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT
        (s."defaultChannel"::text = c."defaultOutbound")                              AS channel_sama,
        (s."campaignRatePerMinute" = (c."safetyConfig"->>'campaignRatePerMinute')::int)  AS campaign_sama,
        (s."duplicateWindowMs" = (c."safetyConfig"->>'duplicateWindowMs')::int)          AS duplikat_sama,
        (s."providerFailureThreshold" = (c."safetyConfig"->>'providerFailureThreshold')::int) AS ambang_sama,
        (s."providerFailureWindowMs" = (c."safetyConfig"->>'providerFailureWindowMs')::int)   AS jendela_sama,
        (s."handoffOnHumanRequest" = r."enabled")                                     AS handoff_sama
       FROM "Settings" s
       CROSS JOIN "ChannelPolicySetting" c
       LEFT JOIN "BotRuleSetting" r ON r."key" = 'bot.handoff_on_human_request'
      WHERE s.id = 1`,
  )
  console.log('\n--- Nilai baru == nilai lama? (semua harus true) ---')
  console.log(JSON.stringify(banding, null, 2))
}

main()
  .catch((error) => {
    console.error('FATAL:', error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => prisma?.$disconnect())

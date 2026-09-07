/**
 * Seeds `BotRuleSetting` from the static rule registry.
 *
 * Safe to re-run: the registry's metadata is re-asserted every time, but an operator's
 * published `config`/`enabled` is never touched. See src/lib/bot-control/rule-seed.ts for why
 * that split is the way round it is.
 *
 *   npm run seed:rules
 */
import { config } from 'dotenv'
import { seedBotRuleSettings } from '../src/lib/bot-control/rule-seed'
import { prisma } from '../src/lib/db'

config()

async function main() {
  const result = await seedBotRuleSettings()
  console.log(
    `Seed rule selesai: ${result.created} dibuat, ${result.updated} disinkronkan, ${result.unchanged} tidak berubah.`
  )
}

main()
  .catch((error: unknown) => {
    console.error('Seed rule gagal', error)
    // A non-zero exit so a deploy script that runs this notices it failed.
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

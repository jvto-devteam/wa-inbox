/**
 * Seeds `BotRuleSetting` and `BotFlowDefinition` from their static registries.
 *
 * Safe to re-run: the registry's metadata is re-asserted every time, but an operator's
 * published `config`/`enabled` is never touched. See src/lib/bot-control/rule-seed.ts for why
 * that split is the way round it is.
 *
 *   npm run seed:rules
 */
// FIRST, and as a side-effecting import rather than a `config()` call further down: ESM
// evaluates every import before any statement in this file, so `src/lib/db.ts` would build its
// Postgres adapter from an empty DATABASE_URL and fail with ECONNREFUSED before dotenv ever
// ran. Import order is the load-bearing part here.
import 'dotenv/config'
import { seedBotRuleSettings } from '../src/lib/bot-control/rule-seed'
import { seedBotFlowDefinitions } from '../src/lib/bot-control/flow-seed'
import { prisma } from '../src/lib/db'

async function main() {
  const rules = await seedBotRuleSettings()
  console.log(
    `Seed rule selesai: ${rules.created} dibuat, ${rules.updated} disinkronkan, ${rules.unchanged} tidak berubah.`
  )

  const flows = await seedBotFlowDefinitions()
  console.log(
    `Seed flow selesai: ${flows.created} dibuat, ${flows.updated} disinkronkan, ${flows.unchanged} tidak berubah.`
  )
}

main()
  .catch((error: unknown) => {
    console.error('Seed rule gagal', error)
    // A non-zero exit so a deploy script that runs this notices it failed.
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

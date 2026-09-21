/**
 * Creates the system templates that do not exist yet. Never updates one that does.
 *
 *   npx tsx scripts/seed-system-templates.ts            # dry run: prints what would be created
 *   npx tsx scripts/seed-system-templates.ts --apply    # writes
 *
 * Create-only on purpose. Once a row exists the operator owns its text (edit → save → live,
 * CLAUDE.md §3); re-running a seed that overwrote bodies would silently undo their edits on
 * the next deploy. A key that changes meaning gets a NEW key, not an overwrite.
 *
 * Run it on the VPS (DATABASE_URL there), after `prisma migrate deploy` has created the table.
 */
import { SYSTEM_TEMPLATE_SEEDS, type SystemTemplateSeed } from '@/lib/system-templates/seed-data'

export type SeedPlan = { create: SystemTemplateSeed[]; existing: string[] }

export function planSeed(seeds: SystemTemplateSeed[], existingKeys: Set<string>): SeedPlan {
  return {
    create: seeds.filter((seed) => !existingKeys.has(seed.key)),
    existing: seeds.filter((seed) => existingKeys.has(seed.key)).map((seed) => seed.key),
  }
}

async function main() {
  const apply = process.argv.includes('--apply')
  const { prisma } = await import('@/lib/db')

  try {
    const rows = await prisma.systemTemplate.findMany({ select: { key: true } })
    const plan = planSeed(SYSTEM_TEMPLATE_SEEDS, new Set(rows.map((row) => row.key)))

    for (const key of plan.existing) console.log(`= ${key} (sudah ada, tidak disentuh)`)
    for (const seed of plan.create) console.log(`${apply ? '+' : '~'} ${seed.key}`)

    if (!apply) {
      console.log(`\nDry run: ${plan.create.length} akan dibuat, ${plan.existing.length} sudah ada. Tambah --apply untuk menulis.`)
      return
    }

    for (const seed of plan.create) {
      await prisma.systemTemplate.create({
        data: {
          key: seed.key,
          name: seed.name,
          description: seed.description,
          audience: seed.audience,
          body: seed.body,
          imageUrl: seed.imageUrl,
          variables: seed.variables,
        },
      })
    }
    console.log(`\n${plan.create.length} dibuat, ${plan.existing.length} sudah ada.`)
  } finally {
    await prisma.$disconnect()
  }
}

// Importing planSeed from a test must never touch a database.
if (require.main === module) {
  main().catch((error) => {
    console.error('Gagal:', error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}

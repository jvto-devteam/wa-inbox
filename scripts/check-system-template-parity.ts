/**
 * Proves every seeded system template renders EXACTLY what the PHP it replaces used to send.
 *
 *   npx tsx scripts/check-system-template-parity.ts          # compare, exit 1 on any mismatch
 *   npx tsx scripts/check-system-template-parity.ts --write  # also refresh the vitest fixture
 *
 * Each template has a PHP file in scripts/system-templates-parity/<key>.php that assigns
 * example values to the ORIGINAL PHP variables, evaluates the original message expression
 * copied verbatim from javavolcano-touroperator / new-backoffice, and prints a JSON array of
 * cases: `[{ "variables": {...}, "text": "<what PHP produced>" }]`. This script renders the seed
 * with the same variables and compares.
 *
 * It exists because transcribing ~19 PHP string concatenations by hand is exactly the kind of
 * work a re-read does not catch (CLAUDE.md §9). With --write, the PHP outputs are stored in
 * src/lib/system-templates/parity-fixtures.json so `npm test` keeps checking parity on machines
 * without PHP.
 *
 * Normalisation applied to the PHP side, and nothing else: \r\n → \n, runs of 3+ newlines → 2,
 * outer whitespace trimmed. Those are the only differences the renderer introduces on purpose.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { SYSTEM_TEMPLATE_SEEDS } from '@/lib/system-templates/seed-data'
import { renderSystemTemplate } from '@/lib/system-templates/render'
import type { VariableValues } from '@/lib/system-templates/types'

type ParityCase = { variables: VariableValues; text: string }

const PARITY_DIR = path.join(__dirname, 'system-templates-parity')
const FIXTURE = path.join(__dirname, '..', 'src', 'lib', 'system-templates', 'parity-fixtures.json')

export function normalisePhpOutput(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

function runPhp(file: string): ParityCase[] {
  const out = execFileSync('php', [file], { encoding: 'utf8' })
  const parsed: unknown = JSON.parse(out)
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error(`${file}: harus mencetak array kasus JSON`)
  return parsed as ParityCase[]
}

function main() {
  const write = process.argv.includes('--write')
  const fixtures: Record<string, ParityCase[]> = {}
  let failures = 0

  for (const seed of SYSTEM_TEMPLATE_SEEDS) {
    const file = path.join(PARITY_DIR, `${seed.key}.php`)
    if (!existsSync(file)) {
      console.error(`✗ ${seed.key}: file paritas ${path.relative(process.cwd(), file)} tidak ada`)
      failures += 1
      continue
    }

    let cases: ParityCase[]
    try {
      cases = runPhp(file)
    } catch (error) {
      console.error(`✗ ${seed.key}: PHP gagal — ${error instanceof Error ? error.message : String(error)}`)
      failures += 1
      continue
    }

    fixtures[seed.key] = cases.map((c) => ({ variables: c.variables, text: normalisePhpOutput(c.text) }))

    cases.forEach((c, index) => {
      const rendered = renderSystemTemplate(seed, c.variables)
      const expected = normalisePhpOutput(c.text)
      if (!rendered.ok) {
        console.error(`✗ ${seed.key} kasus ${index + 1}: variabel wajib kosong — ${rendered.missing.join(', ')}`)
        failures += 1
      } else if (rendered.text !== expected) {
        console.error(`✗ ${seed.key} kasus ${index + 1}: teks berbeda`)
        console.error(`  PHP:   ${JSON.stringify(expected)}`)
        console.error(`  inbox: ${JSON.stringify(rendered.text)}`)
        failures += 1
      } else {
        console.log(`✓ ${seed.key} kasus ${index + 1}`)
      }
    })
  }

  if (write && failures === 0) {
    writeFileSync(FIXTURE, `${JSON.stringify(fixtures, null, 2)}\n`)
    console.log(`Fixture ditulis: ${path.relative(process.cwd(), FIXTURE)}`)
  }

  console.log(`\n${SYSTEM_TEMPLATE_SEEDS.length} template, ${failures} kegagalan`)
  if (failures > 0) process.exitCode = 1
}

if (require.main === module) main()

#!/usr/bin/env tsx
/**
 * Syncs catalog JSON data from the sibling `jvto-whatsapp-agent-runtime` repo
 * into this project's `catalog/` directory, and records the runtime's
 * deployment-gate result.
 *
 * Ported from chatbot-web's `scripts/sync-agent-catalog.js` (a proven pattern
 * in a sibling project), adapted for wa-inbox:
 *  - the source file list is discovered dynamically (readdir) instead of
 *    hardcoded, because the real `catalog/agent-catalog/` and
 *    `catalog/customer-sales/` directories in agent-runtime contain more
 *    files than chatbot-web's script enumerates, and the set can grow;
 *  - filenames that exist in both source directories (e.g.
 *    `general-modules.json`, `module-compatibility.json`,
 *    `package-variations.json`) are byte-compared: when both copies are
 *    identical (confirmed via `cmp` — these are intentionally shared
 *    module-layer data per `catalog-manifest.json`'s `module_layer` block),
 *    the file is copied once, UNPREFIXED. Only a same-named file with
 *    genuinely divergent content is prefixed with its source directory, to
 *    keep both copies without collision.
 *
 *    Keeping shared files unprefixed matters more than it used to: as of Fix
 *    Wave 3b, `src/lib/bot/catalog.ts` (`loadCatalog`) no longer scans the
 *    directory and concatenates every array-shaped file — it reads six
 *    specific filenames (`package-profiles.json`, `standard-price-tiers.json`,
 *    `component-matrices.json`, `module-compatibility.json`,
 *    `general-modules.json`, `customer-link-registry.json`) and joins them on
 *    `package_key`. A prefixed copy is therefore not double-counted but
 *    INVISIBLE to the bot. If two source dirs ever ship genuinely divergent
 *    copies of one of those six files, both land prefixed, the adapter finds
 *    neither, and `loadCatalog` warns that the file is missing — which is the
 *    intended loud failure, but the sync should then be taught which copy is
 *    authoritative rather than left in that state.
 *  - it additionally writes `catalog/meta.json` (`{ syncedAt }`) and shells
 *    out to the agent-runtime's `deployment-gate` CLI to produce
 *    `catalog/deployment-gate.json`.
 *
 * Usage: npm run sync:knowledge
 */

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

// wa-inbox and jvto-whatsapp-agent-runtime are sibling directories on disk
// (e.g. ~/Code/wa-inbox and ~/Code/jvto-whatsapp-agent-runtime), so from
// this file at <project-root>/scripts/, two levels up reaches the parent
// that holds both checkouts — same relative path chatbot-web's script uses.
const RUNTIME_ROOT = path.resolve(__dirname, '../../jvto-whatsapp-agent-runtime')
const DEST = path.resolve(__dirname, '../catalog')

const CATALOG_SOURCE_DIRS = ['agent-catalog', 'customer-sales'] as const

interface DeploymentGateResult {
  readyForApproval: boolean
  blocking: string[]
}

const FALLBACK_GATE_RESULT: DeploymentGateResult = {
  readyForApproval: false,
  blocking: ['deployment-gate command unavailable'],
}

function syncCatalogFiles(): { synced: number; skipped: number } {
  fs.mkdirSync(DEST, { recursive: true })

  let synced = 0
  let skipped = 0

  // Group source files by basename across both source dirs first, so that a
  // filename appearing in both `agent-catalog/` and `customer-sales/` (e.g.
  // `general-modules.json`) can be deduplicated when the two copies are the
  // same underlying shared data, instead of always being prefixed apart.
  const byName = new Map<string, { sourceDir: string; srcPath: string }[]>()

  for (const sourceDir of CATALOG_SOURCE_DIRS) {
    const srcDirPath = path.join(RUNTIME_ROOT, 'catalog', sourceDir)
    if (!fs.existsSync(srcDirPath)) {
      console.warn(`  SKIP (dir not found): catalog/${sourceDir}`)
      continue
    }

    const files = fs
      .readdirSync(srcDirPath, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => entry.name)

    for (const file of files) {
      const entries = byName.get(file) ?? []
      entries.push({ sourceDir, srcPath: path.join(srcDirPath, file) })
      byName.set(file, entries)
    }
  }

  for (const [file, entries] of byName) {
    if (entries.length === 1) {
      const [{ sourceDir, srcPath }] = entries
      if (copyValidatedJson(srcPath, path.join(DEST, file), `catalog/${sourceDir}/${file}`, file)) synced++
      else skipped++
      continue
    }

    // Same filename present in both source dirs: check whether it's genuinely
    // the same shared data (byte-identical — confirmed via `cmp` for
    // `general-modules.json`, `module-compatibility.json`, and
    // `package-variations.json`, and corroborated by `catalog-manifest.json`'s
    // `module_layer` block, which references these as shared module-layer
    // data) or truly divergent content per source dir.
    const buffers = entries.map((e) => fs.readFileSync(e.srcPath))
    const allIdentical = buffers.every((buf) => buf.equals(buffers[0]))

    if (allIdentical) {
      // Shared data: copy once, unprefixed, from the first source dir.
      const { sourceDir, srcPath } = entries[0]
      if (copyValidatedJson(srcPath, path.join(DEST, file), `catalog/${sourceDir}/${file}`, `${file} (shared, deduped)`)) {
        synced++
      } else {
        skipped++
      }
    } else {
      // Genuinely divergent content under the same filename: keep both,
      // disambiguated by source dir so neither is silently lost.
      for (const { sourceDir, srcPath } of entries) {
        const destName = `${sourceDir}--${file}`
        if (copyValidatedJson(srcPath, path.join(DEST, destName), `catalog/${sourceDir}/${file}`, destName)) synced++
        else skipped++
      }
    }
  }

  return { synced, skipped }
}

/** Validates `srcPath` is parseable JSON, then copies it to `dstPath`. Returns whether it was copied. */
function copyValidatedJson(srcPath: string, dstPath: string, label: string, logName: string): boolean {
  try {
    JSON.parse(fs.readFileSync(srcPath, 'utf8'))
  } catch (err) {
    console.warn(`  SKIP (invalid JSON): ${label} — ${(err as Error).message}`)
    return false
  }

  fs.copyFileSync(srcPath, dstPath)
  console.log(`  OK: ${logName}`)
  return true
}

function writeMeta(): void {
  const meta = { syncedAt: new Date().toISOString() }
  fs.writeFileSync(path.join(DEST, 'meta.json'), JSON.stringify(meta, null, 2) + '\n')
  console.log(`  OK: meta.json (syncedAt: ${meta.syncedAt})`)
}

/** Most recently built release dir under dist/releases (release ids sort chronologically). */
function findLatestReleaseDir(): string | null {
  const releasesDir = path.join(RUNTIME_ROOT, 'dist', 'releases')
  if (!fs.existsSync(releasesDir)) return null

  const entries = fs
    .readdirSync(releasesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()

  return entries.length > 0 ? path.join(releasesDir, entries[entries.length - 1]) : null
}

function parseGateOutput(text: string): DeploymentGateResult {
  const parsed = JSON.parse(text)
  if (typeof parsed.ready_for_approval !== 'boolean' || !Array.isArray(parsed.blocking)) {
    throw new Error('unexpected deployment-gate output shape')
  }
  return { readyForApproval: parsed.ready_for_approval, blocking: parsed.blocking }
}

function runDeploymentGate(): DeploymentGateResult {
  if (!fs.existsSync(RUNTIME_ROOT)) {
    console.warn('  SKIP: agent-runtime not found — using fallback deployment-gate result')
    return FALLBACK_GATE_RESULT
  }

  const releaseDir = findLatestReleaseDir()
  if (!releaseDir) {
    console.warn('  SKIP: no release directory found under dist/releases — using fallback deployment-gate result')
    return FALLBACK_GATE_RESULT
  }

  try {
    // Per docs/deployment-approval.md:
    //   python -m jvto_agent_runtime deployment-gate --release-dir <dir>
    // This environment only has `python3` on PATH (no `python` alias), so
    // that's what we invoke.
    const stdout = execFileSync(
      'python3',
      ['-m', 'jvto_agent_runtime', 'deployment-gate', '--release-dir', releaseDir],
      { cwd: RUNTIME_ROOT, encoding: 'utf8' }
    )
    return parseGateOutput(stdout)
  } catch (err) {
    // The CLI's own `main()` does `raise SystemExit(0 if result["ready_for_approval"] else 1)`,
    // so a non-zero exit does NOT necessarily mean the command failed — it commonly
    // means the gate ran successfully and legitimately blocked. execFileSync attaches
    // captured stdout to the thrown error in that case, so recover the real result
    // from it before giving up and using the generic fallback.
    const stdout = (err as { stdout?: Buffer | string }).stdout
    if (stdout) {
      const text = typeof stdout === 'string' ? stdout : stdout.toString('utf8')
      try {
        return parseGateOutput(text)
      } catch {
        // stdout wasn't parseable gate JSON — fall through to generic fallback.
      }
    }
    console.warn(`  WARN: deployment-gate command failed — ${(err as Error).message}`)
    return FALLBACK_GATE_RESULT
  }
}

function writeDeploymentGate(): void {
  const result = runDeploymentGate()
  fs.writeFileSync(path.join(DEST, 'deployment-gate.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(`  OK: deployment-gate.json (readyForApproval: ${result.readyForApproval}, blocking: [${result.blocking.join(', ')}])`)
}

function main(): void {
  if (!fs.existsSync(RUNTIME_ROOT)) {
    console.error(`ERROR: agent-runtime not found at ${RUNTIME_ROOT}`)
    console.error('Expected sibling directory: jvto-whatsapp-agent-runtime')
    process.exit(1)
  }

  console.log(`Syncing catalog from ${RUNTIME_ROOT}`)
  const { synced, skipped } = syncCatalogFiles()
  writeMeta()
  writeDeploymentGate()

  console.log(`\nDone. ${synced} catalog file(s) synced, ${skipped} skipped.`)
  console.log(`Catalog: ${DEST}`)
}

main()

#!/usr/bin/env tsx
/**
 * Operator tool: mints a signed deployment-approval record for the CURRENT catalog/ content
 * (catalog/release-manifest.json + catalog/source-lock.json) and writes it to
 * catalog/deployment-approval.json, where src/lib/bot/deployment-gate.ts's
 * checkDeploymentGate() reads it.
 *
 * This is deliberately a standalone script an operator runs by hand (locally, or over SSH on
 * the VPS) -- never something the running web app can trigger on its own. The whole point of
 * JVTO_DEPLOYMENT_APPROVAL_KEY is that this process cannot self-approve; the key only ever
 * needs to be in this one-off invocation's environment, never in the long-running server's.
 *
 * Usage:
 *   JVTO_DEPLOYMENT_APPROVAL_KEY=... npm run approve:deployment -- --approved-by "Nama Anda"
 */
import fs from 'fs'
import path from 'path'
import { computeReleaseFingerprint, signApproval, APPROVAL_KEY_ENV } from '../src/lib/bot/deployment-gate'

const CATALOG_DIR = path.join(process.cwd(), 'catalog')
const RELEASE_MANIFEST_PATH = path.join(CATALOG_DIR, 'release-manifest.json')
const APPROVAL_PATH = path.join(CATALOG_DIR, 'deployment-approval.json')

function main(): void {
  const key = process.env[APPROVAL_KEY_ENV]
  if (!key) {
    console.error(`ERROR: set ${APPROVAL_KEY_ENV} in the environment before running this.`)
    process.exit(1)
  }

  const approvedByIndex = process.argv.indexOf('--approved-by')
  const approvedBy = approvedByIndex !== -1 ? process.argv[approvedByIndex + 1] : undefined
  if (!approvedBy) {
    console.error('ERROR: pass --approved-by "Nama Anda"')
    process.exit(1)
  }

  if (!fs.existsSync(RELEASE_MANIFEST_PATH)) {
    console.error('ERROR: catalog/release-manifest.json not found -- run `npm run sync:knowledge` first.')
    process.exit(1)
  }

  const manifest = JSON.parse(fs.readFileSync(RELEASE_MANIFEST_PATH, 'utf-8'))
  const releaseId: string | undefined = manifest.release_id
  if (!releaseId) {
    console.error('ERROR: catalog/release-manifest.json has no release_id.')
    process.exit(1)
  }

  const fingerprint = computeReleaseFingerprint()
  const approvedAt = new Date().toISOString()
  const approval = {
    schema_version: 'deployment-approval-v1',
    release_id: releaseId,
    release_fingerprint: fingerprint,
    approved_by: approvedBy,
    approved_at: approvedAt,
    signature: signApproval(releaseId, fingerprint, key),
  }

  fs.writeFileSync(APPROVAL_PATH, JSON.stringify(approval, null, 2) + '\n')
  console.log(`Wrote ${APPROVAL_PATH}`)
  console.log(`Release ${releaseId} approved by ${approvedBy} at ${approvedAt}`)
  console.log('Restart wa-inbox (or wait for the next request) for the gate to pick this up.')
}

main()

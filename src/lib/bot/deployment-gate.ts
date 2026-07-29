import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

// TypeScript port of jvto-whatsapp-agent-runtime's deployment.py (deployment_gate /
// create_approval / verify_deployment_approval) -- wa-inbox now evaluates this itself instead
// of shelling out to the Python sibling repo, which was never deployed to production and
// never will be. The security property is preserved exactly: a release can never self-mark
// customer_traffic_ready, so `checkDeploymentGate` only reports ready once a genuine,
// HMAC-signed approval record exists that (a) matches the CURRENT catalog content by content
// fingerprint and (b) verifies against JVTO_DEPLOYMENT_APPROVAL_KEY -- a secret this process
// never mints on its own (see scripts/approve-deployment.ts, an operator-run tool).
const CATALOG_DIR = path.join(process.cwd(), 'catalog')
const RELEASE_MANIFEST_PATH = path.join(CATALOG_DIR, 'release-manifest.json')
const SOURCE_LOCK_PATH = path.join(CATALOG_DIR, 'source-lock.json')
const APPROVAL_PATH = path.join(CATALOG_DIR, 'deployment-approval.json')
export const APPROVAL_KEY_ENV = 'JVTO_DEPLOYMENT_APPROVAL_KEY'
const APPROVAL_SCHEMA_VERSION = 'deployment-approval-v1'

export type DeploymentApproval = {
  schema_version: string
  release_id: string
  release_fingerprint: string
  approved_by: string
  approved_at: string
  signature: string
  checks_acknowledged?: string[]
}

function sha256File(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function sha256Text(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex')
}

/** A content fingerprint over the release's manifest + source-lock -- matches deployment.py's compute_release_fingerprint. */
export function computeReleaseFingerprint(): string {
  const parts = [sha256File(SOURCE_LOCK_PATH), sha256File(RELEASE_MANIFEST_PATH)]
  return sha256Text(parts.join('|'))
}

function signingPayload(releaseId: string, fingerprint: string): string {
  return `${APPROVAL_SCHEMA_VERSION}|${releaseId}|${fingerprint}`
}

/** HMAC-SHA256 over the canonical (releaseId, fingerprint) payload -- matches deployment.py's sign_approval. */
export function signApproval(releaseId: string, fingerprint: string, key: string): string {
  return crypto.createHmac('sha256', key).update(signingPayload(releaseId, fingerprint), 'utf8').digest('hex')
}

function signaturesMatch(expected: string, actual: string): boolean {
  const expectedBuf = Buffer.from(expected, 'hex')
  const actualBuf = Buffer.from(actual, 'hex')
  // timingSafeEqual throws on a length mismatch rather than returning false -- a
  // tampered/truncated signature must not crash the gate check.
  if (expectedBuf.length !== actualBuf.length) return false
  return crypto.timingSafeEqual(expectedBuf, actualBuf)
}

export function checkDeploymentGate(): { readyForApproval: boolean; blocking: string[] } {
  if (!fs.existsSync(RELEASE_MANIFEST_PATH) || !fs.existsSync(SOURCE_LOCK_PATH)) {
    return { readyForApproval: false, blocking: ['catalog belum pernah disinkron'] }
  }

  let manifest: { release_id?: string }
  try {
    manifest = JSON.parse(fs.readFileSync(RELEASE_MANIFEST_PATH, 'utf-8'))
  } catch {
    return { readyForApproval: false, blocking: ['release-manifest.json tidak valid'] }
  }
  const releaseId = manifest.release_id
  if (!releaseId) return { readyForApproval: false, blocking: ['release-manifest.json tidak punya release_id'] }

  if (!fs.existsSync(APPROVAL_PATH)) {
    return { readyForApproval: false, blocking: ['menunggu persetujuan operator (belum ada catatan approval)'] }
  }

  let approval: DeploymentApproval
  try {
    approval = JSON.parse(fs.readFileSync(APPROVAL_PATH, 'utf-8'))
  } catch {
    return { readyForApproval: false, blocking: ['catatan approval tidak valid (gagal dibaca)'] }
  }

  const blocking: string[] = []
  if (approval.schema_version !== APPROVAL_SCHEMA_VERSION) blocking.push('versi skema approval tidak dikenali')
  if (approval.release_id !== releaseId) blocking.push('approval tidak cocok dengan release_id katalog saat ini')

  const fingerprint = computeReleaseFingerprint()
  if (approval.release_fingerprint !== fingerprint) {
    blocking.push('approval tidak cocok dengan isi katalog saat ini (fingerprint berubah -- perlu approval baru)')
  }

  const key = process.env[APPROVAL_KEY_ENV]
  if (!key) {
    blocking.push(`${APPROVAL_KEY_ENV} belum dikonfigurasi di server`)
  } else if (typeof approval.signature === 'string') {
    const expected = signApproval(approval.release_id, approval.release_fingerprint, key)
    if (!signaturesMatch(expected, approval.signature)) blocking.push('tanda tangan approval tidak valid')
  } else {
    blocking.push('catatan approval tidak punya tanda tangan')
  }

  return { readyForApproval: blocking.length === 0, blocking }
}

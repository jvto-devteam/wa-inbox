import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'

// Real filesystem + real crypto, in a throwaway temp dir standing in for process.cwd()'s
// catalog/ -- this is a security-relevant module (HMAC signature verification), so it's
// exercised against real files and real signatures rather than mocked fs calls, the same way
// the Python original would be tested against real bytes on disk.
let tmpDir: string
let cwdSpy: ReturnType<typeof vi.spyOn>

function catalogDir(): string {
  return path.join(tmpDir, 'catalog')
}

function writeManifestAndLock(releaseId = 'release-1') {
  fs.mkdirSync(catalogDir(), { recursive: true })
  fs.writeFileSync(path.join(catalogDir(), 'release-manifest.json'), JSON.stringify({ release_id: releaseId }))
  fs.writeFileSync(path.join(catalogDir(), 'source-lock.json'), JSON.stringify({ knowledge_catalog: { revision: 'abc' } }))
}

beforeEach(() => {
  vi.resetModules()
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deployment-gate-test-'))
  cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmpDir)
  delete process.env.JVTO_DEPLOYMENT_APPROVAL_KEY
})

afterEach(() => {
  cwdSpy.mockRestore()
  fs.rmSync(tmpDir, { recursive: true, force: true })
  delete process.env.JVTO_DEPLOYMENT_APPROVAL_KEY
})

async function importFresh() {
  return import('./deployment-gate')
}

describe('checkDeploymentGate', () => {
  it('is not ready when the catalog has never been synced', async () => {
    const { checkDeploymentGate } = await importFresh()
    expect(checkDeploymentGate()).toEqual({ readyForApproval: false, blocking: ['catalog belum pernah disinkron'] })
  })

  it('is not ready when there is no approval record yet', async () => {
    writeManifestAndLock()
    const { checkDeploymentGate } = await importFresh()
    const result = checkDeploymentGate()
    expect(result.readyForApproval).toBe(false)
    expect(result.blocking).toContain('menunggu persetujuan operator (belum ada catatan approval)')
  })

  it('is ready when a validly signed approval matches the current release id, fingerprint, and key', async () => {
    writeManifestAndLock('release-1')
    process.env.JVTO_DEPLOYMENT_APPROVAL_KEY = 'test-key'
    const { checkDeploymentGate, computeReleaseFingerprint, signApproval } = await importFresh()

    const fingerprint = computeReleaseFingerprint()
    fs.writeFileSync(
      path.join(catalogDir(), 'deployment-approval.json'),
      JSON.stringify({
        schema_version: 'deployment-approval-v1',
        release_id: 'release-1',
        release_fingerprint: fingerprint,
        approved_by: 'Operator',
        approved_at: new Date().toISOString(),
        signature: signApproval('release-1', fingerprint, 'test-key'),
      })
    )

    expect(checkDeploymentGate()).toEqual({ readyForApproval: true, blocking: [] })
  })

  it('blocks when the approval key is not configured on the server, even with an otherwise-valid record', async () => {
    writeManifestAndLock('release-1')
    const { checkDeploymentGate, computeReleaseFingerprint, signApproval } = await importFresh()
    const fingerprint = computeReleaseFingerprint()
    fs.writeFileSync(
      path.join(catalogDir(), 'deployment-approval.json'),
      JSON.stringify({
        schema_version: 'deployment-approval-v1',
        release_id: 'release-1',
        release_fingerprint: fingerprint,
        approved_by: 'Operator',
        approved_at: new Date().toISOString(),
        signature: signApproval('release-1', fingerprint, 'some-key'),
      })
    )

    const result = checkDeploymentGate()
    expect(result.readyForApproval).toBe(false)
    expect(result.blocking).toContain('JVTO_DEPLOYMENT_APPROVAL_KEY belum dikonfigurasi di server')
  })

  it('blocks when the signature does not verify against the configured key -- a forged/wrong-key record', async () => {
    writeManifestAndLock('release-1')
    process.env.JVTO_DEPLOYMENT_APPROVAL_KEY = 'real-key'
    const { checkDeploymentGate, computeReleaseFingerprint, signApproval } = await importFresh()
    const fingerprint = computeReleaseFingerprint()
    fs.writeFileSync(
      path.join(catalogDir(), 'deployment-approval.json'),
      JSON.stringify({
        schema_version: 'deployment-approval-v1',
        release_id: 'release-1',
        release_fingerprint: fingerprint,
        approved_by: 'Operator',
        approved_at: new Date().toISOString(),
        signature: signApproval('release-1', fingerprint, 'wrong-key'),
      })
    )

    const result = checkDeploymentGate()
    expect(result.readyForApproval).toBe(false)
    expect(result.blocking).toContain('tanda tangan approval tidak valid')
  })

  it('blocks when the approval was minted for a different release id than the one currently synced', async () => {
    writeManifestAndLock('release-2')
    process.env.JVTO_DEPLOYMENT_APPROVAL_KEY = 'test-key'
    const { checkDeploymentGate, computeReleaseFingerprint, signApproval } = await importFresh()
    const fingerprint = computeReleaseFingerprint()
    fs.writeFileSync(
      path.join(catalogDir(), 'deployment-approval.json'),
      JSON.stringify({
        schema_version: 'deployment-approval-v1',
        release_id: 'release-1', // stale -- the synced catalog is now release-2
        release_fingerprint: fingerprint,
        approved_by: 'Operator',
        approved_at: new Date().toISOString(),
        signature: signApproval('release-1', fingerprint, 'test-key'),
      })
    )

    const result = checkDeploymentGate()
    expect(result.readyForApproval).toBe(false)
    expect(result.blocking).toContain('approval tidak cocok dengan release_id katalog saat ini')
  })

  it('blocks when the catalog content changed after the approval was signed -- fingerprint mismatch', async () => {
    writeManifestAndLock('release-1')
    process.env.JVTO_DEPLOYMENT_APPROVAL_KEY = 'test-key'
    const gate1 = await importFresh()
    const staleFingerprint = gate1.computeReleaseFingerprint()
    fs.writeFileSync(
      path.join(catalogDir(), 'deployment-approval.json'),
      JSON.stringify({
        schema_version: 'deployment-approval-v1',
        release_id: 'release-1',
        release_fingerprint: staleFingerprint,
        approved_by: 'Operator',
        approved_at: new Date().toISOString(),
        signature: gate1.signApproval('release-1', staleFingerprint, 'test-key'),
      })
    )

    // Catalog content changes post-approval (same release_id, different bytes) -- re-sync.
    fs.writeFileSync(path.join(catalogDir(), 'source-lock.json'), JSON.stringify({ knowledge_catalog: { revision: 'changed' } }))

    const result = gate1.checkDeploymentGate()
    expect(result.readyForApproval).toBe(false)
    expect(result.blocking).toContain('approval tidak cocok dengan isi katalog saat ini (fingerprint berubah -- perlu approval baru)')
  })

  it('computeReleaseFingerprint is the same regardless of file mtimes -- stable across re-syncs of identical data', async () => {
    writeManifestAndLock('release-1')
    const { computeReleaseFingerprint } = await importFresh()
    const first = computeReleaseFingerprint()
    // Rewrite with byte-identical content.
    writeManifestAndLock('release-1')
    const second = computeReleaseFingerprint()
    expect(first).toBe(second)
  })
})

describe('signApproval', () => {
  it('produces a different signature for a different key -- the whole point of the HMAC', async () => {
    const { signApproval } = await importFresh()
    expect(signApproval('release-1', 'fp', 'key-a')).not.toBe(signApproval('release-1', 'fp', 'key-b'))
  })
})

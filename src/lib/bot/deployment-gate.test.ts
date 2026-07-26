import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import { checkDeploymentGate } from './deployment-gate'

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn(),
      readFileSync: vi.fn(),
    },
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  }
})

describe('checkDeploymentGate', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reads the synced gate status', () => {
    ;(fs.existsSync as any).mockReturnValue(true)
    ;(fs.readFileSync as any).mockReturnValue(JSON.stringify({ readyForApproval: false, blocking: ['core_dataset_not_production_ready'] }))

    expect(checkDeploymentGate()).toEqual({ readyForApproval: false, blocking: ['core_dataset_not_production_ready'] })
  })

  it('defaults to not-ready when the catalog has never been synced', () => {
    ;(fs.existsSync as any).mockReturnValue(false)
    expect(checkDeploymentGate()).toEqual({ readyForApproval: false, blocking: ['catalog belum pernah disinkron'] })
  })
})

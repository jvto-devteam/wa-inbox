import { describe, it, expect, vi } from 'vitest'
import { GET } from './route'
import { checkDeploymentGate } from '@/lib/bot/deployment-gate'

vi.mock('@/lib/bot/deployment-gate')

describe('GET /api/bot/gate-status', () => {
  it('returns the deployment gate status', async () => {
    vi.mocked(checkDeploymentGate).mockReturnValue({ readyForApproval: false, blocking: ['core_dataset_not_production_ready'] })
    const res = await GET()
    expect(await res.json()).toEqual({ readyForApproval: false, blocking: ['core_dataset_not_production_ready'] })
  })
})

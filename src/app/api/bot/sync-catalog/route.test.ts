import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { execSync } from 'child_process'
import { prisma } from '@/lib/db'
import { verifySessionToken } from '@/lib/auth/session'
import { POST } from './route'

// `vi.mock` factories are hoisted above regular imports and `let`/`const`
// declarations, so the mock instance must be constructed inline inside the
// factory rather than via an outer variable.
vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))
// `next/server` pulls in modules that reach for `child_process`'s default
// export, so the mock has to provide one alongside the named export.
vi.mock('child_process', () => {
  const execSync = vi.fn()
  return { execSync, default: { execSync } }
})

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

function request(withCookie = true) {
  return new Request('http://localhost/api/bot/sync-catalog', {
    method: 'POST',
    headers: withCookie ? { cookie: 'wa_inbox_session=tok' } : {},
  })
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.mocked(execSync).mockReset()
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_admin', role: 'ADMIN', tokenVersion: 0 })
})

describe('POST /api/bot/sync-catalog', () => {
  it('runs the sync and stamps catalogSyncedAt when called by an admin', async () => {
    mockPrisma.settings.update.mockResolvedValue({ id: 1 } as never)
    const res = await POST(request())
    expect(res.status).toBe(200)
    expect(execSync).toHaveBeenCalledWith('npm run sync:knowledge', expect.anything())
  })

  it('rejects when the caller is not an admin — and never spawns the child process', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_agent', role: 'AGENT', tokenVersion: 0 })
    const res = await POST(request())
    expect(res.status).toBe(403)
    expect(execSync).not.toHaveBeenCalled()
    expect(mockPrisma.settings.update).not.toHaveBeenCalled()
  })

  it('rejects when there is no session cookie at all', async () => {
    const res = await POST(request(false))
    expect(res.status).toBe(403)
    expect(execSync).not.toHaveBeenCalled()
  })

  it('returns 500 with a legible message when the sync command fails', async () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error('exit 1')
    })
    const res = await POST(request())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/Sinkronisasi gagal/)
  })
})

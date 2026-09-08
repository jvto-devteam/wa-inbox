/**
 * @vitest-environment node
 *
 * The list and the button have to mean the same thing by "menggantung".
 *
 * The Outbound Queue page shows a "hanya yang menggantung" filter next to a "Pulihkan job
 * menggantung" button, and the whole point of the filter is that an operator can see what the
 * button would touch BEFORE pressing it during an incident. If the two ever describe different
 * rows the page becomes a liar: the list shows nothing and recovery moves forty jobs, or the
 * list shows forty and recovery moves none.
 *
 * So this test does not check either definition against a literal — a literal copied into a
 * test drifts exactly as easily as a literal copied into a second module. It runs BOTH code
 * paths against the same mocked Prisma at the same frozen instant and compares the where-clause
 * each one actually sent. Inline a changed clause in either place and this fails.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { verifySessionToken } from '@/lib/auth/session'
import { recoverStuckOutboundJobs } from '@/lib/outbound/worker'
import { GET } from './route'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))
vi.mock('@/lib/coexist/client', () => ({ sendCoexistText: vi.fn(), sendCoexistMedia: vi.fn() }))
vi.mock('@/lib/meta/messages', () => ({ sendMetaText: vi.fn(), sendMetaMedia: vi.fn() }))
vi.mock('@/lib/meta/media-upload', () => ({ uploadMetaMediaFromUrl: vi.fn() }))
vi.mock('@/lib/realtime', () => ({ broadcast: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

const NOW = new Date('2026-09-07T10:00:00.000Z')

beforeEach(() => {
  mockReset(mockPrisma)
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_1', role: 'AGENT', tokenVersion: 0 })
  mockPrisma.outboundJob.findMany.mockResolvedValue([] as never)
  mockPrisma.outboundJob.count.mockResolvedValue(0 as never)
  mockPrisma.conversation.findMany.mockResolvedValue([] as never)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('definisi "menggantung" pada filter dan pada recover', () => {
  it('filter ?stuck=true mengirim where yang identik dengan recoverStuckOutboundJobs', async () => {
    await GET(
      new Request('http://localhost/api/outbound-jobs?stuck=true', {
        headers: { cookie: 'wa_inbox_session=tok' },
      })
    )
    const filterWhere = mockPrisma.outboundJob.findMany.mock.calls[0][0]?.where

    mockPrisma.outboundJob.findMany.mockClear()
    await recoverStuckOutboundJobs()
    const recoveryWhere = mockPrisma.outboundJob.findMany.mock.calls[0][0]?.where

    // Not `toMatchObject`: an extra condition on either side is a divergence too. A recovery
    // that also required `attempts < maxAttempts`, say, would move fewer rows than the list
    // promised, and the operator would be left believing recovery had failed.
    expect(filterWhere).toEqual(recoveryWhere)
    expect(filterWhere).toEqual({ status: 'SENDING', updatedAt: { lt: new Date(NOW.getTime() - 5 * 60_000) } })
  })

  it('recover memakai window yang sama saat mengklaim baris seperti saat mencarinya', async () => {
    // The conditional updateMany re-checks staleness so a merely-slow worker that has since
    // written SENT is not dragged back onto the ladder and sent twice. Re-checking a DIFFERENT
    // window from the search would reopen exactly that hole.
    mockPrisma.outboundJob.findMany.mockResolvedValue([
      { id: 'job_stale', attempts: 0, maxAttempts: 4, messageId: 'msg_1', conversationId: 'conv_1' },
    ] as never)
    mockPrisma.outboundJob.updateMany.mockResolvedValue({ count: 0 } as never)

    await recoverStuckOutboundJobs()

    const searchWhere = mockPrisma.outboundJob.findMany.mock.calls[0][0]?.where
    const claimWhere = mockPrisma.outboundJob.updateMany.mock.calls[0][0]?.where
    expect(claimWhere).toEqual({ id: 'job_stale', ...searchWhere })
  })
})

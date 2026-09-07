/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { verifySessionToken } from '@/lib/auth/session'
import { GET } from './route'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

function request(key: string, withSession = true) {
  return new Request(`http://localhost/api/bot-control/flows/${key}`, {
    headers: withSession ? { cookie: 'wa_inbox_session=tok' } : {},
  })
}

// Next 16 hands `params` in as a Promise; the route must await it.
function params(key: string) {
  return { params: Promise.resolve({ key }) }
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.clearAllMocks()
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_1', role: 'AGENT', tokenVersion: 0 })
  mockPrisma.botFlowDefinition.findUnique.mockResolvedValue(null as never)
})

describe('GET /api/bot-control/flows/[key]', () => {
  it('returns the full definition with nodes and edges', async () => {
    const res = await GET(request('whatsapp-existing-bot-v1'), params('whatsapp-existing-bot-v1'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.key).toBe('whatsapp-existing-bot-v1')
    expect(body.nodes).toHaveLength(28)
    expect(body.edges.length).toBeGreaterThan(0)
  })

  it('returns 404 with the mandated { error } shape for an unknown key', async () => {
    const res = await GET(request('nope'), params('nope'))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Flow tidak ditemukan' })
  })

  it('checks the session before looking anything up', async () => {
    const res = await GET(request('whatsapp-existing-bot-v1', false), params('whatsapp-existing-bot-v1'))
    expect(res.status).toBe(401)
  })

  it('reports an unseeded flow as READ_ONLY with no editable fields', async () => {
    // Opening a flow for editing has to be a deliberate act; a missing row fails closed.
    const body = await (await GET(request('whatsapp-existing-bot-v1'), params('whatsapp-existing-bot-v1'))).json()
    expect(body.editableLevel).toBe('READ_ONLY')
    expect(body.editableFields).toEqual([])
    expect(body.activeVersion).toBeNull()
    expect(body.draftVersion).toBeNull()
  })

  it('layers the published config and the pending draft over the static node map', async () => {
    mockPrisma.botFlowDefinition.findUnique.mockResolvedValue({
      key: 'whatsapp-existing-bot-v1',
      editableLevel: 'SAFE_CONFIG',
      runtimeSource: 'database',
      versions: [
        { id: 'ver_2', version: 2, status: 'DRAFT', nodeConfig: { fallbackReply: 'Baru' }, changeReason: 'Ganti kalimat', publishedAt: null, releaseId: null, createdAt: new Date() },
        { id: 'ver_1', version: 1, status: 'PUBLISHED', nodeConfig: { fallbackReply: 'Lama' }, changeReason: null, publishedAt: new Date(), releaseId: 'rel_1', createdAt: new Date() },
      ],
    } as never)

    const body = await (await GET(request('whatsapp-existing-bot-v1'), params('whatsapp-existing-bot-v1'))).json()
    // The node map still comes from the registry: nodes are `if` statements, not rows.
    expect(body.nodes).toHaveLength(28)
    expect(body.activeVersion).toMatchObject({ version: 1, config: { fallbackReply: 'Lama' } })
    expect(body.draftVersion).toMatchObject({ version: 2, status: 'DRAFT', config: { fallbackReply: 'Baru' } })
    expect(body.editableFields.length).toBeGreaterThan(0)
  })

  it('surfaces a stored config this build cannot read as null, not as raw Json', async () => {
    // That is exactly the config the runtime loader is also ignoring.
    mockPrisma.botFlowDefinition.findUnique.mockResolvedValue({
      key: 'whatsapp-existing-bot-v1',
      editableLevel: 'SAFE_CONFIG',
      runtimeSource: 'database',
      versions: [
        { id: 'ver_1', version: 1, status: 'PUBLISHED', nodeConfig: { branchingRules: [] }, changeReason: null, publishedAt: null, releaseId: null, createdAt: new Date() },
      ],
    } as never)

    const body = await (await GET(request('whatsapp-existing-bot-v1'), params('whatsapp-existing-bot-v1'))).json()
    expect(body.activeVersion.config).toBeNull()
  })
})
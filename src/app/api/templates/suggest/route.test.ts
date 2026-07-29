import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { verifySessionToken } from '@/lib/auth/session'
import { suggestTemplates } from '@/lib/bot/template-suggester'
import { POST } from './route'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))
vi.mock('@/lib/bot/template-suggester', () => ({ suggestTemplates: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

function request(withCookie = true) {
  return new Request('http://localhost/api/templates/suggest', {
    method: 'POST',
    headers: withCookie ? { cookie: 'wa_inbox_session=tok' } : {},
  })
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.mocked(suggestTemplates).mockReset()
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_admin', role: 'ADMIN', tokenVersion: 0 })
  mockPrisma.settings.findUniqueOrThrow.mockResolvedValue({ ollamaModel: 'gemma4:31b-cloud' } as never)
})

describe('POST /api/templates/suggest', () => {
  it('analyzes recent inbound text messages across the whole inbox and returns suggestions', async () => {
    mockPrisma.message.findMany.mockResolvedValue([{ content: 'Berapa harga paket ke Ijen?' }, { content: 'Harga Bromo berapa?' }] as never)
    vi.mocked(suggestTemplates).mockResolvedValue([
      { name: 'info_harga', body: 'Halo {{1}}', variables: [{ name: 'nama', bindingKey: 'contactName' }], reason: 'Sering ditanya' },
    ])

    const res = await POST(request())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.suggestions).toHaveLength(1)
    expect(mockPrisma.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { direction: 'INBOUND', type: 'text', content: { not: null } } })
    )
    expect(suggestTemplates).toHaveBeenCalledWith(
      ['Berapa harga paket ke Ijen?', 'Harga Bromo berapa?'],
      'gemma4:31b-cloud'
    )
  })

  it('filters out blank message content before analyzing', async () => {
    mockPrisma.message.findMany.mockResolvedValue([{ content: '   ' }, { content: 'Real question' }] as never)
    vi.mocked(suggestTemplates).mockResolvedValue([])

    await POST(request())

    expect(suggestTemplates).toHaveBeenCalledWith(['Real question'], 'gemma4:31b-cloud')
  })

  it('returns an empty list without calling the LLM when there are no inbound messages at all', async () => {
    mockPrisma.message.findMany.mockResolvedValue([])

    const res = await POST(request())

    expect((await res.json()).suggestions).toEqual([])
    expect(suggestTemplates).not.toHaveBeenCalled()
  })

  it('returns 502 with the error message when the suggester throws', async () => {
    mockPrisma.message.findMany.mockResolvedValue([{ content: 'halo' }] as never)
    vi.mocked(suggestTemplates).mockRejectedValue(new Error('Model tidak mengembalikan JSON yang valid'))

    const res = await POST(request())

    expect(res.status).toBe(502)
    expect((await res.json()).error).toBe('Model tidak mengembalikan JSON yang valid')
  })

  it('rejects a non-admin caller', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_agent', role: 'AGENT', tokenVersion: 0 })
    const res = await POST(request())
    expect(res.status).toBe(403)
    expect(mockPrisma.message.findMany).not.toHaveBeenCalled()
  })

  it('rejects an unauthenticated caller', async () => {
    const res = await POST(request(false))
    expect(res.status).toBe(403)
  })
})

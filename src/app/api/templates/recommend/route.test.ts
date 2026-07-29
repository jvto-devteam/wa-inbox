import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { verifySessionToken } from '@/lib/auth/session'
import { recommendTemplates } from '@/lib/bot/template-recommender'
import { POST } from './route'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))
vi.mock('@/lib/bot/template-recommender', () => ({ recommendTemplates: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

function request(body: unknown, withCookie = true) {
  return new Request('http://localhost/api/templates/recommend', {
    method: 'POST',
    headers: withCookie ? { cookie: 'wa_inbox_session=tok' } : {},
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.mocked(recommendTemplates).mockReset()
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_1', role: 'AGENT', tokenVersion: 0 })
  mockPrisma.settings.findUniqueOrThrow.mockResolvedValue({ ollamaModel: 'gemma4:31b-cloud' } as never)
})

describe('POST /api/templates/recommend', () => {
  it('recommends templates based on the last inbound text message, scoped to the given channel', async () => {
    mockPrisma.message.findFirst.mockResolvedValue({ content: 'Berapa harga paket ke Ijen?' } as never)
    mockPrisma.template.findMany.mockResolvedValue([{ id: 'tpl_2', name: 'Harga Paket', body: 'Berikut harga...' }] as never)
    vi.mocked(recommendTemplates).mockResolvedValue([{ templateId: 'tpl_2', templateName: 'Harga Paket', reason: 'cocok' }])

    const res = await POST(request({ conversationId: 'conv_1', channel: 'OFFICIAL' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.recommendations).toEqual([{ templateId: 'tpl_2', templateName: 'Harga Paket', reason: 'cocok' }])
    expect(mockPrisma.message.findFirst).toHaveBeenCalledWith({
      where: { conversationId: 'conv_1', direction: 'INBOUND', type: 'text' },
      orderBy: { createdAt: 'desc' },
    })
    expect(mockPrisma.template.findMany).toHaveBeenCalledWith({ where: { type: 'OFFICIAL', metaStatus: 'APPROVED' } })
    expect(recommendTemplates).toHaveBeenCalledWith(
      'Berapa harga paket ke Ijen?',
      [{ id: 'tpl_2', name: 'Harga Paket', body: 'Berikut harga...' }],
      'gemma4:31b-cloud'
    )
  })

  it('queries QUICK_REPLY templates (no metaStatus filter) for the Unofficial channel', async () => {
    mockPrisma.message.findFirst.mockResolvedValue({ content: 'halo' } as never)
    mockPrisma.template.findMany.mockResolvedValue([])
    vi.mocked(recommendTemplates).mockResolvedValue([])

    await POST(request({ conversationId: 'conv_1', channel: 'UNOFFICIAL' }))

    expect(mockPrisma.template.findMany).toHaveBeenCalledWith({ where: { type: 'QUICK_REPLY' } })
  })

  it('returns 400 when there is no inbound message to analyze', async () => {
    mockPrisma.message.findFirst.mockResolvedValue(null)

    const res = await POST(request({ conversationId: 'conv_1', channel: 'OFFICIAL' }))

    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Tidak ada pesan masuk untuk dianalisis')
    expect(recommendTemplates).not.toHaveBeenCalled()
  })

  it('returns an empty list without calling the LLM when there are no templates for the channel', async () => {
    mockPrisma.message.findFirst.mockResolvedValue({ content: 'halo' } as never)
    mockPrisma.template.findMany.mockResolvedValue([])

    const res = await POST(request({ conversationId: 'conv_1', channel: 'OFFICIAL' }))

    expect((await res.json()).recommendations).toEqual([])
    expect(recommendTemplates).not.toHaveBeenCalled()
  })

  it('returns 502 with the error message when the recommender throws', async () => {
    mockPrisma.message.findFirst.mockResolvedValue({ content: 'halo' } as never)
    mockPrisma.template.findMany.mockResolvedValue([{ id: 'tpl_1', name: 'x', body: 'y' }] as never)
    vi.mocked(recommendTemplates).mockRejectedValue(new Error('Model tidak mengembalikan JSON yang valid'))

    const res = await POST(request({ conversationId: 'conv_1', channel: 'OFFICIAL' }))

    expect(res.status).toBe(502)
    expect((await res.json()).error).toBe('Model tidak mengembalikan JSON yang valid')
  })

  it('rejects an unauthenticated caller', async () => {
    const res = await POST(request({ conversationId: 'conv_1', channel: 'OFFICIAL' }, false))
    expect(res.status).toBe(401)
    expect(mockPrisma.message.findFirst).not.toHaveBeenCalled()
  })

  it('rejects a malformed body', async () => {
    const res = await POST(request({ conversationId: 'conv_1' }))
    expect(res.status).toBe(400)
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { POST } from './route'
import { sendMessage } from '@/lib/send'
import { prisma } from '@/lib/db'

vi.mock('@/lib/send', () => ({ sendMessage: vi.fn() }))
// `vi.mock` factories are hoisted above regular imports and `let`/`const`
// declarations, so the mock instance must be constructed inline inside the
// factory (referencing only the already-imported `mockDeep` and the erased
// `PrismaClient` type) rather than via an outer variable — otherwise the
// factory throws "Cannot access ... before initialization".
vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

beforeEach(() => {
  vi.clearAllMocks()
  mockReset(mockPrisma)
})

describe('POST /api/send', () => {
  it('calls sendMessage with the request body and returns the created message', async () => {
    vi.mocked(sendMessage).mockResolvedValue({ id: 'msg_1', deliveryStatus: 'SENT' } as never)
    const req = new Request('http://localhost/api/send', {
      method: 'POST',
      body: JSON.stringify({ conversationId: 'conv_1', text: 'Halo!' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: 'msg_1', deliveryStatus: 'SENT' })
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'conv_1', text: 'Halo!', sentBy: 'AGENT' }))
  })

  it('returns 400 when text is missing', async () => {
    const req = new Request('http://localhost/api/send', { method: 'POST', body: JSON.stringify({ conversationId: 'conv_1' }) })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('resolves a phone-based { to, text } body to its conversation and sends', async () => {
    mockPrisma.contact.findUnique.mockResolvedValue({
      id: 'contact_1',
      phone: '6281234567890',
      conversation: { id: 'conv_1' },
    } as never)
    vi.mocked(sendMessage).mockResolvedValue({ id: 'msg_1', deliveryStatus: 'SENT' } as never)

    const req = new Request('http://localhost/api/send', {
      method: 'POST',
      body: JSON.stringify({ to: '6281234567890', text: 'Halo!' }),
    })
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: 'msg_1', deliveryStatus: 'SENT' })
    expect(mockPrisma.contact.findUnique).toHaveBeenCalledWith({
      where: { phone: '6281234567890' },
      include: { conversation: true },
    })
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'conv_1', text: 'Halo!', sentBy: 'AGENT' }))
  })

  it('returns 404 when the phone number has no matching Contact', async () => {
    mockPrisma.contact.findUnique.mockResolvedValue(null)

    const req = new Request('http://localhost/api/send', {
      method: 'POST',
      body: JSON.stringify({ to: '6289999999999', text: 'Halo!' }),
    })
    const res = await POST(req)

    expect(res.status).toBe(404)
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('returns 404 when the Contact exists but has no Conversation yet', async () => {
    mockPrisma.contact.findUnique.mockResolvedValue({
      id: 'contact_1',
      phone: '6281234567890',
      conversation: null,
    } as never)

    const req = new Request('http://localhost/api/send', {
      method: 'POST',
      body: JSON.stringify({ to: '6281234567890', text: 'Halo!' }),
    })
    const res = await POST(req)

    expect(res.status).toBe(404)
    expect(sendMessage).not.toHaveBeenCalled()
  })
})

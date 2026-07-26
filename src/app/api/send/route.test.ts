import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from './route'
import { sendMessage } from '@/lib/send'

vi.mock('@/lib/send', () => ({ sendMessage: vi.fn() }))

beforeEach(() => vi.clearAllMocks())

describe('POST /api/send', () => {
  it('calls sendMessage with the request body and returns the created message', async () => {
    ;(sendMessage as any).mockResolvedValue({ id: 'msg_1', deliveryStatus: 'SENT' })
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
})

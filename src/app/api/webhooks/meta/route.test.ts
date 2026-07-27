import { describe, it, expect, beforeAll, vi } from 'vitest'
import crypto from 'crypto'
import { GET, POST } from './route'
import { ingestMetaMessage } from '@/lib/inbound'

vi.mock('@/lib/inbound', () => ({
  ingestMetaMessage: vi.fn().mockResolvedValue({ processed: 0, skipped: 0, statusUpdates: 0, templateStatusUpdates: 0 }),
}))

beforeAll(() => {
  process.env.META_WEBHOOK_VERIFY_TOKEN = 'my-verify-token'
  process.env.META_APP_SECRET = 'app-secret'
})

describe('GET /api/webhooks/meta', () => {
  it('echoes hub.challenge when token matches', async () => {
    const url = 'http://localhost/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=my-verify-token&hub.challenge=12345'
    const res = await GET(new Request(url))
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('12345')
  })

  it('rejects a wrong token', async () => {
    const url = 'http://localhost/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=12345'
    const res = await GET(new Request(url))
    expect(res.status).toBe(403)
  })
})

describe('POST /api/webhooks/meta', () => {
  it('accepts a correctly signed payload and ingests it', async () => {
    const body = JSON.stringify({ entry: [] })
    const sig = 'sha256=' + crypto.createHmac('sha256', 'app-secret').update(body).digest('hex')
    const req = new Request('http://localhost/api/webhooks/meta', {
      method: 'POST',
      headers: { 'x-hub-signature-256': sig },
      body,
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(ingestMetaMessage).toHaveBeenCalled()
  })

  it('rejects a payload with a bad signature', async () => {
    const req = new Request('http://localhost/api/webhooks/meta', {
      method: 'POST',
      headers: { 'x-hub-signature-256': 'sha256=deadbeef' },
      body: JSON.stringify({ entry: [] }),
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })
})

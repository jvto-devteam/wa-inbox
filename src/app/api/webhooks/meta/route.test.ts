import { describe, it, expect, beforeAll } from 'vitest'
import { GET } from './route'

beforeAll(() => {
  process.env.META_WEBHOOK_VERIFY_TOKEN = 'my-verify-token'
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

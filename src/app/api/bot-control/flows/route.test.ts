/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { verifySessionToken } from '@/lib/auth/session'
import { GET } from './route'

vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))

const withCookie = new Request('http://localhost/api/bot-control/flows', {
  headers: { cookie: 'wa_inbox_session=tok' },
})

beforeEach(() => {
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_1', role: 'AGENT', tokenVersion: 0 })
})

describe('GET /api/bot-control/flows', () => {
  it('returns the flow list in the shape the contract specifies', async () => {
    const res = await GET(withCookie)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.flows).toEqual([
      expect.objectContaining({
        key: 'whatsapp-existing-bot-v1',
        name: 'WhatsApp Existing Bot',
        version: 1,
        nodesCount: 28,
        status: 'ACTIVE',
      }),
    ])
  })

  it('lets an AGENT read it — Bot Control is read-only for agents, not admin-only', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_1', role: 'AGENT', tokenVersion: 0 })
    expect((await GET(withCookie)).status).toBe(200)
  })

  it('rejects a request with no session as 401 and the mandated { error } shape', async () => {
    const res = await GET(new Request('http://localhost/api/bot-control/flows'))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Tidak terautentikasi' })
  })

  it('rejects an invalid session token', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue(null)
    expect((await GET(withCookie)).status).toBe(401)
  })

  it('never leaks node bodies in the list response', async () => {
    // The list endpoint is fetched on every page load; shipping 28 full node objects with it
    // would make it several kilobytes for data the list view does not render.
    const body = await (await GET(withCookie)).json()
    expect(body.flows[0]).not.toHaveProperty('nodes')
    expect(body.flows[0]).not.toHaveProperty('edges')
  })
})

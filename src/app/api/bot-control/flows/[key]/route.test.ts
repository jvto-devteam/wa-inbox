/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { verifySessionToken } from '@/lib/auth/session'
import { GET } from './route'

vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))

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
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_1', role: 'AGENT', tokenVersion: 0 })
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
})

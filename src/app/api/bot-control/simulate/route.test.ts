/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { verifySessionToken } from '@/lib/auth/session'
import { runSimulation } from '@/lib/bot-control/simulator'
import { sendMessage } from '@/lib/send'
import { POST } from './route'

vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))
vi.mock('@/lib/bot-control/simulator', () => ({ runSimulation: vi.fn() }))
vi.mock('@/lib/send', () => ({ sendMessage: vi.fn() }))

function req(body: unknown, withSession = true) {
  return new Request('http://localhost/api/bot-control/simulate', {
    method: 'POST',
    headers: withSession ? { cookie: 'wa_inbox_session=tok', 'Content-Type': 'application/json' } : {},
    body: JSON.stringify(body),
  })
}

const result = {
  mode: 'faq',
  reply: 'Rp 1.500.000',
  status: 'WOULD_REPLY' as const,
  flowSteps: [],
  knowledgeRefs: { sourceTopic: 'price' },
  verification: null,
  warnings: ['Simulasi dijalankan pada percakapan sandbox...'],
  wouldSendViaChannel: 'UNOFFICIAL' as const,
  decisionRunId: 'run_sim_1',
  latencyMs: 1200,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_admin', role: 'ADMIN', tokenVersion: 0 })
  vi.mocked(runSimulation).mockResolvedValue(result)
})

describe('POST /api/bot-control/simulate', () => {
  it('returns the simulation result in the shape the contract specifies', async () => {
    const res = await POST(req({ message: 'berapa harga ijen?', dryRun: true }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(result)
  })

  it('never sends a WhatsApp message', async () => {
    await POST(req({ message: 'berapa harga ijen?' }))
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('passes the chosen conversation context through', async () => {
    await POST(req({ message: 'halo', conversationId: 'conv_1', useExistingHistory: true }))
    expect(runSimulation).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv_1', useExistingHistory: true })
    )
  })

  it('refuses an AGENT — a simulation spends real LLM time and writes an audit row', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_1', role: 'AGENT', tokenVersion: 0 })

    const res = await POST(req({ message: 'halo' }))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Hanya admin yang bisa menjalankan simulasi' })
    expect(runSimulation).not.toHaveBeenCalled()
  })

  it('refuses a request with no session before doing any work', async () => {
    const res = await POST(req({ message: 'halo' }, false))
    expect(res.status).toBe(403)
    expect(runSimulation).not.toHaveBeenCalled()
  })

  it('rejects an empty message with 400 and the mandated { error } shape', async () => {
    const res = await POST(req({ message: '' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Data simulasi tidak valid' })
    expect(runSimulation).not.toHaveBeenCalled()
  })

  it('rejects dryRun: false rather than silently treating it as a dry run', async () => {
    // This endpoint cannot send. Accepting `dryRun: false` would be a lie about what the
    // caller asked for.
    const res = await POST(req({ message: 'halo', dryRun: false }))
    expect(res.status).toBe(400)
    expect(runSimulation).not.toHaveBeenCalled()
  })

  it('rejects a non-JSON body with 400 rather than an unhandled 500', async () => {
    const bad = new Request('http://localhost/api/bot-control/simulate', {
      method: 'POST',
      headers: { cookie: 'wa_inbox_session=tok' },
      body: 'not json',
    })
    expect((await POST(bad)).status).toBe(400)
  })

  it('returns 500 with the mandated { error } shape when the simulation throws', async () => {
    vi.mocked(runSimulation).mockRejectedValue(new Error('boom'))
    const res = await POST(req({ message: 'halo' }))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Simulasi gagal — cek log server' })
  })
})

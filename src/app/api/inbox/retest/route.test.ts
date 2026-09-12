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

const result = {
  mode: 'faq',
  reply: 'Harga ATV Rp400.000.',
  status: 'WOULD_REPLY',
  flowSteps: [],
  knowledgeRefs: { sourceTopic: 'price' },
  knowledge: { catalogLines: [], managedLines: [], rejected: [], gateBypassed: false, attributions: [] },
  verification: null,
  warnings: ['Simulasi dijalankan pada percakapan sandbox, bukan percakapan aslinya.'],
  wouldSendViaChannel: 'UNOFFICIAL',
  decisionRunId: 'run_sim_1',
  latencyMs: 1200,
}

function req(body: unknown, withSession = true) {
  return new Request('http://localhost/api/inbox/retest', {
    method: 'POST',
    headers: withSession ? { cookie: 'wa_inbox_session=tok', 'Content-Type': 'application/json' } : {},
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_agent', role: 'AGENT', tokenVersion: 0 })
  vi.mocked(runSimulation).mockResolvedValue(result as never)
})

describe('POST /api/inbox/retest', () => {
  it('terbuka untuk AGENT, dan menjalankan simulasi dengan konteks percakapan aslinya', async () => {
    const res = await POST(req({ message: 'berapa harga ATV sekarang?', conversationId: 'conv_1' }))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(result)
    expect(runSimulation).toHaveBeenCalledWith({
      message: 'berapa harga ATV sekarang?',
      conversationId: 'conv_1',
      useExistingHistory: true,
    })
  })

  it('tidak pernah mengirim apa pun ke pelanggan', async () => {
    await POST(req({ message: 'berapa harga ATV sekarang?', conversationId: 'conv_1' }))
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('401 tanpa sesi, tanpa menjalankan simulasi', async () => {
    const res = await POST(req({ message: 'x', conversationId: 'conv_1' }, false))
    expect(res.status).toBe(401)
    expect(runSimulation).not.toHaveBeenCalled()
  })

  it('400 lewat Zod: pesan kosong, percakapan kosong, atau field tambahan', async () => {
    for (const body of [
      { message: '', conversationId: 'conv_1' },
      { message: 'x', conversationId: '' },
      { message: 'x', conversationId: 'conv_1', dryRun: false },
    ]) {
      const res = await POST(req(body))
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'Data uji ulang tidak valid' })
    }
    expect(runSimulation).not.toHaveBeenCalled()
  })

  it('500 dengan bentuk { error } bila simulasi gagal', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(runSimulation).mockRejectedValue(new Error('ollama down'))
    const res = await POST(req({ message: 'x', conversationId: 'conv_1' }))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Gagal menjalankan uji ulang' })
  })
})

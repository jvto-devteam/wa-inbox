/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { authenticateApiClient } from '@/lib/api-clients/auth'
import { enqueueSystemTemplateSend } from '@/lib/system-templates/send'
import { POST } from './route'

vi.mock('@/lib/api-clients/auth', () => ({ authenticateApiClient: vi.fn() }))
vi.mock('@/lib/system-templates/send', () => ({ enqueueSystemTemplateSend: vi.fn() }))

const body = {
  templateKey: 'payment_received_first',
  to: { phone: '6281234567890' },
  variables: { name: 'Anna', pax: 2 },
  idempotencyKey: 'payment_received_first:1',
}

const post = (payload: unknown, key = 'wai_secret') =>
  POST(
    new Request('http://x/api/v1/system-messages', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: typeof payload === 'string' ? payload : JSON.stringify(payload),
    })
  )

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(authenticateApiClient).mockResolvedValue({ id: 'client_1', name: 'jvto' })
  vi.mocked(enqueueSystemTemplateSend).mockResolvedValue({ ok: true, jobId: 'job_1', status: 'QUEUED', duplicate: false })
})

describe('POST /api/v1/system-messages', () => {
  it('rejects a request without a valid key, before reading the body', async () => {
    vi.mocked(authenticateApiClient).mockResolvedValue(null)
    const res = await post(body)
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'API key tidak valid' })
    expect(enqueueSystemTemplateSend).not.toHaveBeenCalled()
  })

  it('queues a valid send as the authenticated client and answers 202', async () => {
    const res = await post(body)
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ jobId: 'job_1', status: 'QUEUED', duplicate: false })
    expect(enqueueSystemTemplateSend).toHaveBeenCalledWith({ clientId: 'client_1', ...body })
  })

  it('answers 200 with duplicate:true for an idempotency key already used', async () => {
    vi.mocked(enqueueSystemTemplateSend).mockResolvedValue({ ok: true, jobId: 'job_0', status: 'SENT', duplicate: true })
    const res = await post(body)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ jobId: 'job_0', status: 'SENT', duplicate: true })
  })

  it('accepts a group destination', async () => {
    await post({ ...body, to: { groupId: '120363335090996109@g.us' } })
    expect(enqueueSystemTemplateSend).toHaveBeenCalledWith(
      expect.objectContaining({ to: { groupId: '120363335090996109@g.us' } })
    )
  })

  it.each([
    ['not JSON', '{nope'],
    ['no idempotency key', { ...body, idempotencyKey: undefined }],
    ['both phone and group', { ...body, to: { phone: '62812', groupId: '1@g.us' } }],
    ['a group id that is not a group JID', { ...body, to: { groupId: '6281234567890' } }],
    ['an object as a variable value', { ...body, variables: { name: { first: 'A' } } }],
  ])('rejects a malformed body (%s) with 400', async (_label, payload) => {
    const res = await post(payload)
    expect(res.status).toBe(400)
    expect(typeof (await res.json()).error).toBe('string')
    expect(enqueueSystemTemplateSend).not.toHaveBeenCalled()
  })

  it('names the missing required variables', async () => {
    vi.mocked(enqueueSystemTemplateSend).mockResolvedValue({ ok: false, code: 'MISSING_VARIABLES', missing: ['booking_code', 'pax'] })
    const res = await post(body)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Variabel wajib kosong: booking_code, pax' })
  })

  it('answers 404 for an unknown template and 400 for a bad phone', async () => {
    vi.mocked(enqueueSystemTemplateSend).mockResolvedValue({ ok: false, code: 'TEMPLATE_NOT_FOUND' })
    expect((await post(body)).status).toBe(404)

    vi.mocked(enqueueSystemTemplateSend).mockResolvedValue({ ok: false, code: 'INVALID_PHONE' })
    expect((await post(body)).status).toBe(400)
  })

  it('answers 503 when the job could not be queued, so the caller retries', async () => {
    vi.mocked(enqueueSystemTemplateSend).mockResolvedValue({ ok: false, code: 'ENQUEUE_FAILED' })
    expect((await post(body)).status).toBe(503)
  })

  it('never leaks an internal error message', async () => {
    vi.mocked(enqueueSystemTemplateSend).mockRejectedValue(new Error('connection string postgres://secret'))
    const res = await post(body)
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('secret')
  })

  it('never echoes the API key back', async () => {
    const res = await post(body, 'wai_do-not-echo')
    expect(JSON.stringify(await res.json())).not.toContain('wai_do-not-echo')
  })
})

import { describe, it, expect, beforeAll, vi } from 'vitest'
import crypto from 'crypto'
import { GET, POST } from './route'
import { describeWebhookFailure } from '@/lib/meta/webhook-failure'
import { saveWebhookFailure } from '@/lib/meta/webhook-failure-store'
import { ingestMetaMessage } from '@/lib/inbound'

vi.mock('@/lib/meta/webhook-failure-store', () => ({ saveWebhookFailure: vi.fn().mockResolvedValue(undefined) }))
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

  // Tiga app Meta menembak endpoint yang sama, masing-masing dengan rahasianya sendiri.
  // Satu rahasia yang terlewat di daftar TIDAK menghasilkan error yang bisa dibaca: seluruh
  // pesan dari app itu ditolak 401 dan hilang tanpa jejak. Tes ini menyebut ketiga env var
  // secara eksplisit supaya menghapus salah satunya membuat suite merah, bukan Inbox sunyi.
  it.each([
    ['META_APP_SECRET', 'rahasia-wa'],
    ['FB_APP_SECRET', 'rahasia-fb'],
    ['IG_APP_SECRET', 'rahasia-ig'],
  ])('menerima tanda tangan dari %s', async (envVar, secret) => {
    vi.stubEnv(envVar, secret)
    const body = JSON.stringify({ entry: [] })
    const sig = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex')
    const res = await POST(
      new Request('http://localhost/api/webhooks/meta', {
        method: 'POST',
        headers: { 'x-hub-signature-256': sig },
        body,
      }),
    )
    expect(res.status).toBe(200)
    vi.unstubAllEnvs()
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

  it('returns 400 (not 500) for a validly signed but non-JSON body', async () => {
    const body = 'not json'
    const sig = 'sha256=' + crypto.createHmac('sha256', 'app-secret').update(body).digest('hex')
    const req = new Request('http://localhost/api/webhooks/meta', {
      method: 'POST',
      headers: { 'x-hub-signature-256': sig },
      body,
    })
    const callCountBefore = vi.mocked(ingestMetaMessage).mock.calls.length
    const res = await POST(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(typeof json.error).toBe('string')
    expect(vi.mocked(ingestMetaMessage).mock.calls.length).toBe(callCountBefore)
  })

  it('returns 500 with a generic {error} body (not the raw error) when ingestion fails', async () => {
    vi.mocked(ingestMetaMessage).mockRejectedValueOnce(new Error('db is down: connection string leaked'))
    const body = JSON.stringify({ entry: [] })
    const sig = 'sha256=' + crypto.createHmac('sha256', 'app-secret').update(body).digest('hex')
    const req = new Request('http://localhost/api/webhooks/meta', {
      method: 'POST',
      headers: { 'x-hub-signature-256': sig },
      body,
    })
    const res = await POST(req)
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(typeof json.error).toBe('string')
    expect(json.error).not.toContain('db is down')
  })

  it('2026-11-27: galat ingest dicatat (jenis + bentuk payload) tanpa nomor/isi pesan', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(ingestMetaMessage).mockRejectedValueOnce(new Error('Argument externalId is missing for 6281234567890 a@b.co'))
    const payload = {
      object: 'whatsapp_business_account',
      entry: [{ id: '1', changes: [{ field: 'messages', value: { contacts: [{ profile: { name: 'Khairul' }, user_id: 'MY.1' }], messages: [{ from_user_id: 'MY.1', id: 'wamid.X', text: { body: 'halo rahasia' }, type: 'text' }] } }] }],
    }
    const body = JSON.stringify(payload)
    const sig = 'sha256=' + crypto.createHmac('sha256', 'app-secret').update(body).digest('hex')
    const res = await POST(new Request('http://localhost/api/webhooks/meta', { method: 'POST', headers: { 'x-hub-signature-256': sig }, body }))
    expect(res.status).toBe(500)
    const logged = JSON.stringify(err.mock.calls)
    expect(logged).toContain('from_user_id')
    expect(logged).toContain('externalId is missing')
    expect(logged).not.toMatch(/6281234567890|a@b\.co|halo rahasia|Khairul|wamid\.X/)
    // Isi mentahnya disimpan untuk diproses ulang tick (jaring pengaman), jawaban tetap 500.
    expect(saveWebhookFailure).toHaveBeenCalledWith(body, expect.any(Error))
    err.mockRestore()
  })

  it('describeWebhookFailure tahan payload aneh', () => {
    expect(describeWebhookFailure(null, 'x')).toMatchObject({ error: 'string', object: null, shape: '[]' })
  })
})


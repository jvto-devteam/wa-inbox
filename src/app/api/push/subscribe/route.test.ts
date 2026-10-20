/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))

import { prisma } from '@/lib/db'
import { verifySessionToken } from '@/lib/auth/session'
import { DELETE, POST } from './route'

const db = prisma as unknown as DeepMockProxy<PrismaClient>
const call = (method: string, body: unknown) =>
  new Request('http://localhost/api/push/subscribe', {
    method,
    headers: { cookie: 'wa_inbox_session=tok', 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
const good = { endpoint: 'https://push.example/abc', keys: { p256dh: 'pk', auth: 'ak' } }

beforeEach(() => {
  mockReset(db)
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc1', role: 'AGENT', tokenVersion: 0 })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('POST /api/push/subscribe', () => {
  it('subscribe requires session and validates keys', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue(null)
    expect((await POST(call('POST', good))).status).toBe(401)
    vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc1', role: 'AGENT', tokenVersion: 0 })
    expect((await POST(call('POST', { ...good, endpoint: 'bukan-url' }))).status).toBe(400)
    expect((await POST(call('POST', { endpoint: good.endpoint, keys: { p256dh: 'pk' } }))).status).toBe(400)
    expect((await POST(call('POST', 'not json'))).status).toBe(400)
    expect(db.pushSubscription.upsert).not.toHaveBeenCalled()
  })

  it('upserts per endpoint for any logged-in account (AGENT)', async () => {
    const res = await POST(call('POST', good))
    expect(res.status).toBe(200)
    expect(db.pushSubscription.upsert).toHaveBeenCalledWith({
      where: { endpoint: good.endpoint },
      create: { accountId: 'acc1', endpoint: good.endpoint, p256dh: 'pk', auth: 'ak' },
      update: { accountId: 'acc1', p256dh: 'pk', auth: 'ak' },
    })
  })

  it('500 hides raw error', async () => {
    db.pushSubscription.upsert.mockRejectedValue(new Error('secret db detail'))
    const res = await POST(call('POST', good))
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('secret')
  })
})

describe('DELETE /api/push/subscribe', () => {
  it('requires session', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue(null)
    expect((await DELETE(call('DELETE', { endpoint: good.endpoint }))).status).toBe(401)
  })

  it('deletes only the caller own endpoint', async () => {
    expect((await DELETE(call('DELETE', { endpoint: good.endpoint }))).status).toBe(200)
    expect(db.pushSubscription.deleteMany).toHaveBeenCalledWith({ where: { endpoint: good.endpoint, accountId: 'acc1' } })
  })

  it('400 for invalid body', async () => {
    expect((await DELETE(call('DELETE', {}))).status).toBe(400)
  })
})

/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))

import { prisma } from '@/lib/db'
import { verifySessionToken } from '@/lib/auth/session'
import { POST } from './route'

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>
const DAY = 24 * 60 * 60 * 1000
const iso = (ms: number) => new Date(Date.now() + ms).toISOString()
const call = (body: unknown, id = 'si1') =>
  POST(
    new Request('http://localhost/api/summary-items/' + id + '/schedule', {
      method: 'POST',
      headers: { cookie: 'wa_inbox_session=tok', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) }
  )

const item = (o: Record<string, unknown> = {}) => ({
  id: 'si1', state: 'OPEN', reminderId: null, conversation: { contactId: 'ct1' }, ...o,
})
const updatedRow = {
  id: 'si1', conversationId: 'c1', kind: 'REPLY', state: 'SCHEDULED',
  anchorAt: new Date('2026-10-17T01:00:00Z'), anchorMessageId: null, snippet: 'halo', review: null,
  handoff: false, newLead: false, openedOn: '2026-10-17', dueAt: new Date('2026-10-20T00:00:00Z'),
  conversation: { pipelineStage: 'NEW', contact: { name: 'Budi' } },
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_agent', role: 'AGENT', tokenVersion: 0 })
  mockPrisma.$transaction.mockImplementation(((cb: (tx: unknown) => unknown) => cb(mockPrisma)) as never)
  mockPrisma.summaryItem.update.mockResolvedValue(updatedRow as never)
})

describe('POST /api/summary-items/[id]/schedule', () => {
  it('401 tanpa sesi', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue(null)
    expect((await call({ dueAt: iso(DAY), note: 'x' })).status).toBe(401)
  })

  it('membuat reminder baru dan mengembalikan SummaryItemView', async () => {
    mockPrisma.summaryItem.findUnique.mockResolvedValue(item() as never)
    mockPrisma.reminder.create.mockResolvedValue({ id: 'rem_new' } as never)
    const dueAt = iso(DAY)
    const res = await call({ dueAt, note: '  tanya lagi  ' })
    expect(res.status).toBe(200)
    expect(mockPrisma.reminder.create).toHaveBeenCalledWith({
      data: { contactId: 'ct1', dueAt: new Date(dueAt), note: 'tanya lagi' },
    })
    expect(mockPrisma.summaryItem.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'si1' }, data: { state: 'SCHEDULED', reminderId: 'rem_new', dueAt: new Date(dueAt) } })
    )
    expect(await res.json()).toMatchObject({ id: 'si1', state: 'SCHEDULED', contactName: 'Budi', dueAt: '2026-10-20T00:00:00.000Z' })
  })

  it('memperbarui reminder yang ada dan belum done', async () => {
    mockPrisma.summaryItem.findUnique.mockResolvedValue(item({ state: 'SCHEDULED', reminderId: 'rem1' }) as never)
    mockPrisma.reminder.findUnique.mockResolvedValue({ id: 'rem1', done: false } as never)
    mockPrisma.reminder.update.mockResolvedValue({ id: 'rem1' } as never)
    const res = await call({ dueAt: iso(2 * DAY), note: 'baru' })
    expect(res.status).toBe(200)
    expect(mockPrisma.reminder.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'rem1' }, data: expect.objectContaining({ note: 'baru' }) })
    )
    expect(mockPrisma.reminder.create).not.toHaveBeenCalled()
  })

  it('reminder lama sudah done → buat reminder baru', async () => {
    mockPrisma.summaryItem.findUnique.mockResolvedValue(item({ reminderId: 'rem1' }) as never)
    mockPrisma.reminder.findUnique.mockResolvedValue({ id: 'rem1', done: true } as never)
    mockPrisma.reminder.create.mockResolvedValue({ id: 'rem2' } as never)
    await call({ dueAt: iso(DAY), note: 'x' })
    expect(mockPrisma.reminder.create).toHaveBeenCalled()
    expect(mockPrisma.reminder.update).not.toHaveBeenCalled()
  })

  it.each([
    ['dueAt lampau', { dueAt: iso(-DAY), note: 'x' }],
    ['dueAt > 90 hari', { dueAt: iso(91 * DAY), note: 'x' }],
    ['note kosong', { dueAt: iso(DAY), note: '   ' }],
    ['note > 500', { dueAt: iso(DAY), note: 'a'.repeat(501) }],
    ['dueAt bukan tanggal', { dueAt: 'besok', note: 'x' }],
  ])('400 untuk %s', async (_n, body) => {
    const res = await call(body)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: expect.any(String) })
    expect(mockPrisma.reminder.create).not.toHaveBeenCalled()
  })

  it('404 bila item tidak ada', async () => {
    mockPrisma.summaryItem.findUnique.mockResolvedValue(null)
    expect((await call({ dueAt: iso(DAY), note: 'x' })).status).toBe(404)
  })

  it('409 bila item sudah DONE', async () => {
    mockPrisma.summaryItem.findUnique.mockResolvedValue(item({ state: 'DONE' }) as never)
    expect((await call({ dueAt: iso(DAY), note: 'x' })).status).toBe(409)
  })

  it('500 { error } bila prisma gagal', async () => {
    mockPrisma.summaryItem.findUnique.mockRejectedValue(new Error('boom'))
    const res = await call({ dueAt: iso(DAY), note: 'x' })
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: expect.any(String) })
  })
})

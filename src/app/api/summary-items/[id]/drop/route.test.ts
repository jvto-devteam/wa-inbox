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
const call = (body: unknown, id = 'si1') =>
  POST(
    new Request('http://localhost/api/summary-items/' + id + '/drop', {
      method: 'POST',
      headers: { cookie: 'wa_inbox_session=tok', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) }
  )

beforeEach(() => {
  mockReset(mockPrisma)
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_agent', role: 'AGENT', tokenVersion: 0 })
  mockPrisma.$transaction.mockImplementation(((cb: (tx: unknown) => unknown) => cb(mockPrisma)) as never)
})

describe('POST /api/summary-items/[id]/drop', () => {
  it('401 tanpa sesi', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue(null)
    expect((await call({})).status).toBe(401)
  })

  it('menyimpan closedById & menandai reminder terkait done', async () => {
    mockPrisma.summaryItem.findUnique.mockResolvedValue({ id: 'si1', state: 'SCHEDULED', reminderId: 'rem1' } as never)
    const res = await call({ note: '  sudah booking lewat telepon ' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(mockPrisma.summaryItem.update).toHaveBeenCalledWith({
      where: { id: 'si1' },
      data: {
        state: 'DROPPED', closedReason: 'DROPPED', note: 'sudah booking lewat telepon',
        closedById: 'acc_agent', closedAt: expect.any(Date),
      },
    })
    expect(mockPrisma.reminder.updateMany).toHaveBeenCalledWith({ where: { id: 'rem1', done: false }, data: { done: true } })
  })

  it('note kosong → null, tanpa reminder tidak menyentuh reminder', async () => {
    mockPrisma.summaryItem.findUnique.mockResolvedValue({ id: 'si1', state: 'OPEN', reminderId: null } as never)
    const res = await call({ note: '   ' })
    expect(res.status).toBe(200)
    expect(mockPrisma.summaryItem.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ note: null }) })
    )
    expect(mockPrisma.reminder.updateMany).not.toHaveBeenCalled()
  })

  it('400 untuk note > 500', async () => {
    expect((await call({ note: 'a'.repeat(501) })).status).toBe(400)
  })

  it('404 bila item tidak ada', async () => {
    mockPrisma.summaryItem.findUnique.mockResolvedValue(null)
    expect((await call({})).status).toBe(404)
  })

  it('409 bila item sudah DONE', async () => {
    mockPrisma.summaryItem.findUnique.mockResolvedValue({ id: 'si1', state: 'DONE', reminderId: null } as never)
    expect((await call({})).status).toBe(409)
  })

  it('500 { error } bila prisma gagal', async () => {
    mockPrisma.summaryItem.findUnique.mockRejectedValue(new Error('boom'))
    const res = await call({})
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: expect.any(String) })
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { verifySessionToken } from '@/lib/auth/session'
import { writeBotAuditLog } from '@/lib/bot-control/audit'
import { PATCH } from './route'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))
vi.mock('@/lib/bot-control/audit', () => ({ writeBotAuditLog: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

const existing = {
  id: 'tpl_1',
  key: 'internal_new_booking',
  name: 'New booking',
  description: null,
  audience: 'INTERNAL',
  body: '*New Booking*\n*Name:* {name}\n*Drop:* {drop}',
  imageUrl: null,
  variables: [
    { name: 'name', required: true },
    { name: 'drop', required: false },
  ],
  isActive: true,
  updatedById: null,
  createdAt: new Date('2026-09-21T00:00:00Z'),
  updatedAt: new Date('2026-09-21T00:00:00Z'),
}

const patch = (body: unknown, key = 'internal_new_booking') =>
  PATCH(
    new Request('http://localhost', {
      method: 'PATCH',
      headers: { cookie: 'wa_inbox_session=tok' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ key }) }
  )

beforeEach(() => {
  mockReset(mockPrisma)
  vi.mocked(writeBotAuditLog).mockReset()
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_admin', role: 'ADMIN', tokenVersion: 0 })
  mockPrisma.systemTemplate.findUnique.mockResolvedValue(existing as never)
  mockPrisma.systemTemplate.update.mockImplementation(((args: { data: object }) =>
    Promise.resolve({ ...existing, ...args.data })) as never)
  mockPrisma.account.findUnique.mockResolvedValue({ name: 'Admin' } as never)
})

describe('PATCH /api/system-templates/[key]', () => {
  it('is admin-only', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_agent', role: 'AGENT', tokenVersion: 0 })
    expect((await patch({ body: 'x' })).status).toBe(403)
    expect(mockPrisma.systemTemplate.update).not.toHaveBeenCalled()
  })

  it('saves a new body straight away and audits it', async () => {
    const res = await patch({ body: '*Booking baru*\n*Nama:* {name}' })

    expect(res.status).toBe(200)
    expect(mockPrisma.systemTemplate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: 'internal_new_booking' },
        data: expect.objectContaining({ body: '*Booking baru*\n*Nama:* {name}', updatedById: 'acc_admin' }),
      })
    )
    expect(writeBotAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'UPDATE', entityType: 'SYSTEM_TEMPLATE', entityKey: 'internal_new_booking' })
    )
  })

  it('refuses a body that uses a variable the callers never send', async () => {
    const res = await patch({ body: 'Halo {nama_tamu}' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('{nama_tamu}')
    expect(mockPrisma.systemTemplate.update).not.toHaveBeenCalled()
  })

  it('refuses to add a variable name that is not already part of the contract', async () => {
    const res = await patch({
      variables: [
        { name: 'name', required: true },
        { name: 'hotel', required: true },
      ],
    })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('hotel')
  })

  it('lets a variable become optional', async () => {
    const res = await patch({
      variables: [
        { name: 'name', required: false },
        { name: 'drop', required: false },
      ],
    })
    expect(res.status).toBe(200)
  })

  it('refuses to change the key', async () => {
    expect((await patch({ key: 'renamed' })).status).toBe(400)
  })

  it('records switching a template off as DISABLE', async () => {
    await patch({ isActive: false })
    expect(writeBotAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'DISABLE' }))
  })

  it('returns 404 for an unknown key', async () => {
    mockPrisma.systemTemplate.findUnique.mockResolvedValue(null)
    expect((await patch({ body: 'x' }, 'nope')).status).toBe(404)
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { GET, PATCH, DELETE } from './route'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

beforeEach(() => {
  mockReset(mockPrisma)
})

describe('GET /api/templates/[id]', () => {
  it('returns the template when found', async () => {
    mockPrisma.template.findUnique.mockResolvedValue({ id: 't1', name: 'harga_paket', type: 'QUICK_REPLY' } as never)
    const res = await GET(new Request('http://localhost'), { params: Promise.resolve({ id: 't1' }) })
    expect(res.status).toBe(200)
    expect((await res.json()).name).toBe('harga_paket')
  })

  it('returns 404 when the template does not exist', async () => {
    mockPrisma.template.findUnique.mockResolvedValue(null)
    const res = await GET(new Request('http://localhost'), { params: Promise.resolve({ id: 'missing' }) })
    expect(res.status).toBe(404)
  })
})

describe('PATCH /api/templates/[id]', () => {
  it('updates a QUICK_REPLY template freely', async () => {
    mockPrisma.template.findUnique.mockResolvedValue({ id: 't1', type: 'QUICK_REPLY', metaStatus: 'NOT_APPLICABLE' } as never)
    mockPrisma.template.update.mockResolvedValue({ id: 't1', name: 'harga_baru', body: 'Info harga baru' } as never)

    const req = new Request('http://localhost', { method: 'PATCH', body: JSON.stringify({ name: 'harga_baru', body: 'Info harga baru' }) })
    const res = await PATCH(req, { params: Promise.resolve({ id: 't1' }) })

    expect(res.status).toBe(200)
    expect(mockPrisma.template.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { name: 'harga_baru', body: 'Info harga baru' },
    })
  })

  it('rejects editing an OFFICIAL template that has already been submitted to Meta', async () => {
    mockPrisma.template.findUnique.mockResolvedValue({ id: 't2', type: 'OFFICIAL', metaStatus: 'PENDING' } as never)

    const req = new Request('http://localhost', { method: 'PATCH', body: JSON.stringify({ body: 'Teks baru' }) })
    const res = await PATCH(req, { params: Promise.resolve({ id: 't2' }) })

    expect(res.status).toBe(409)
    expect(mockPrisma.template.update).not.toHaveBeenCalled()
  })

  it('returns 404 when the template does not exist', async () => {
    mockPrisma.template.findUnique.mockResolvedValue(null)
    const req = new Request('http://localhost', { method: 'PATCH', body: JSON.stringify({ body: 'Teks baru' }) })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'missing' }) })
    expect(res.status).toBe(404)
  })
})

describe('DELETE /api/templates/[id]', () => {
  it('deletes the template', async () => {
    mockPrisma.template.delete.mockResolvedValue({} as never)
    const res = await DELETE(new Request('http://localhost'), { params: Promise.resolve({ id: 't1' }) })
    expect(res.status).toBe(200)
    expect(mockPrisma.template.delete).toHaveBeenCalledWith({ where: { id: 't1' } })
  })
})

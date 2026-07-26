import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { GET, POST } from './route'

// `vi.mock` factories are hoisted above regular imports and `let`/`const`
// declarations, so the mock instance must be constructed inline inside the
// factory (referencing only the already-imported `mockDeep` and the erased
// `PrismaClient` type) rather than via an outer variable — otherwise the
// factory throws "Cannot access ... before initialization".
vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

beforeEach(() => {
  mockReset(mockPrisma)
})

describe('labels API', () => {
  it('GET lists all labels', async () => {
    mockPrisma.label.findMany.mockResolvedValue([{ id: 'lbl_1', name: 'Confirmed Booking', color: '#3C6B42' }] as never)

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body[0].name).toBe('Confirmed Booking')
  })

  it('POST creates a label', async () => {
    mockPrisma.label.create.mockResolvedValue({ id: 'lbl_2', name: 'New Customer', color: '#106877' } as never)

    const req = new Request('http://localhost/api/labels', {
      method: 'POST',
      body: JSON.stringify({ name: 'New Customer', color: '#106877' }),
    })
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.name).toBe('New Customer')
    expect(mockPrisma.label.create).toHaveBeenCalledWith({ data: { name: 'New Customer', color: '#106877' } })
  })

  it('POST rejects a missing name or color', async () => {
    const req = new Request('http://localhost/api/labels', {
      method: 'POST',
      body: JSON.stringify({ name: '', color: '' }),
    })
    const res = await POST(req)

    expect(res.status).toBe(400)
    expect(mockPrisma.label.create).not.toHaveBeenCalled()
  })
})

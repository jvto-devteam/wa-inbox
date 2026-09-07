/**
 * @vitest-environment node
 *
 * Regression cover for the audit finding "ContactConsent tidak pernah ditulis (tidak ada
 * create/update di mana pun), jadi cabang opt-out di safety-guard.ts tidak pernah bisa terpicu".
 *
 * The model, its migration and its index all shipped, and `checkOutboundSafety` read the table
 * on every queued send — but the ONLY reference to `contactConsent` in the whole of src/ was
 * that `findUnique`. The table could not contain a row, so the block was unreachable by
 * construction. These tests pin the writer that makes it reachable.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { verifySessionToken } from '@/lib/auth/session'
import { GET, PUT } from './route'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>
const params = Promise.resolve({ id: 'contact_1' })

function req(body?: unknown, withSession = true) {
  return new Request('http://localhost/api/contacts/contact_1/consent', {
    method: body === undefined ? 'GET' : 'PUT',
    headers: withSession ? { cookie: 'wa_inbox_session=tok', 'Content-Type': 'application/json' } : {},
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

const row = {
  optOut: true,
  optIn: false,
  source: 'AGENT',
  note: 'Diminta lewat WhatsApp',
  updatedAt: new Date('2026-09-07T02:00:00.000Z'),
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.clearAllMocks()
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_1', role: 'AGENT', tokenVersion: 0 })
  mockPrisma.contact.findUnique.mockResolvedValue({ id: 'contact_1' } as never)
  mockPrisma.contactConsent.upsert.mockResolvedValue(row as never)
})

describe('GET /api/contacts/[id]/consent', () => {
  it('menolak permintaan tanpa sesi', async () => {
    expect((await GET(req(undefined, false), { params })).status).toBe(401)
  })

  it('membedakan "belum pernah ditanyakan" dari "boleh menerima"', async () => {
    // Absence is not consent. Returning a fabricated opt-in default would let an operator
    // believe permission was collected when nobody ever collected it.
    mockPrisma.contactConsent.findUnique.mockResolvedValue(null as never)

    expect((await (await GET(req(), { params })).json()).consent).toBeNull()
  })
})

describe('PUT /api/contacts/[id]/consent', () => {
  it('benar-benar menulis baris opt-out, yang sebelumnya tidak pernah terjadi', async () => {
    const res = await PUT(req({ optOut: true, note: 'Diminta lewat WhatsApp' }), { params })

    expect(res.status).toBe(200)
    expect(mockPrisma.contactConsent.upsert).toHaveBeenCalledTimes(1)
    const call = mockPrisma.contactConsent.upsert.mock.calls[0][0]
    expect(call.where).toEqual({ contactId: 'contact_1' })
    expect(call.create).toMatchObject({ contactId: 'contact_1', optOut: true, updatedBy: 'acc_1' })
  })

  it('menjaga optIn selalu kebalikan optOut, karena guard membaca keduanya', async () => {
    // checkOutboundSafety blocks on `optOut === true || optIn === false`. Letting the two
    // disagree would make the block depend on whichever field was written last.
    await PUT(req({ optOut: true }), { params })
    expect(mockPrisma.contactConsent.upsert.mock.calls[0][0].create).toMatchObject({ optOut: true, optIn: false })

    vi.clearAllMocks()
    mockPrisma.contact.findUnique.mockResolvedValue({ id: 'contact_1' } as never)
    mockPrisma.contactConsent.upsert.mockResolvedValue({ ...row, optOut: false, optIn: true } as never)
    await PUT(req({ optOut: false }), { params })
    expect(mockPrisma.contactConsent.upsert.mock.calls[0][0].create).toMatchObject({ optOut: false, optIn: true })
  })

  it('menolak body yang tidak valid tanpa menyentuh tabel', async () => {
    expect((await PUT(req({ optOut: 'ya' }), { params })).status).toBe(400)
    expect(mockPrisma.contactConsent.upsert).not.toHaveBeenCalled()
  })

  it('menolak kontak yang tidak ada, bukan membuat baris yatim', async () => {
    mockPrisma.contact.findUnique.mockResolvedValue(null as never)

    expect((await PUT(req({ optOut: true }), { params })).status).toBe(404)
    expect(mockPrisma.contactConsent.upsert).not.toHaveBeenCalled()
  })

  it('menolak permintaan tanpa sesi', async () => {
    expect((await PUT(req({ optOut: true }, false), { params })).status).toBe(401)
  })
})

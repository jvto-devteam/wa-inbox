import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { requestSync } from '@/lib/gmail/sync'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/gmail/sync', () => ({ requestSync: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>
import { POST } from './route'

const TOKEN = 't'.repeat(32)
const push = (data: unknown, token = TOKEN) => new Request(`https://h/api/webhooks/gmail?token=${token}`, {
  method: 'POST',
  body: JSON.stringify({ message: { data: Buffer.from(JSON.stringify(data)).toString('base64'), messageId: '1' }, subscription: 's' }),
})

beforeEach(() => {
  mockReset(mockPrisma)
  vi.stubEnv('GMAIL_PUSH_TOKEN', TOKEN)
  vi.mocked(requestSync).mockReset().mockResolvedValue({} as never)
})

describe('POST /api/webhooks/gmail', () => {
  it('token salah: 403, tidak menyentuh database', async () => {
    const res = await POST(push({ emailAddress: 'hello@x.com' }, 'z'.repeat(32)))
    expect(res.status).toBe(403)
    expect(mockPrisma.mailAccount.findUnique).not.toHaveBeenCalled()
  })

  it('bel untuk kotak surat yang dikenal memicu sinkronisasi dan langsung ack 204', async () => {
    mockPrisma.mailAccount.findUnique.mockResolvedValue({ id: 'mail_1' } as never)
    const res = await POST(push({ emailAddress: 'Hello@X.com', historyId: 5 }))
    expect(res.status).toBe(204)
    expect(mockPrisma.mailAccount.findUnique).toHaveBeenCalledWith({ where: { emailAddress: 'hello@x.com' }, select: { id: true } })
    expect(requestSync).toHaveBeenCalledWith('mail_1')
  })

  it('kotak surat tak dikenal atau payload rusak: tetap ack 204 supaya Pub/Sub tidak mengulang selamanya', async () => {
    mockPrisma.mailAccount.findUnique.mockResolvedValue(null as never)
    expect((await POST(push({ emailAddress: 'lain@x.com' }))).status).toBe(204)
    expect((await POST(new Request(`https://h/api/webhooks/gmail?token=${TOKEN}`, { method: 'POST', body: 'bukan json' }))).status).toBe(204)
    expect(requestSync).not.toHaveBeenCalled()
  })
})

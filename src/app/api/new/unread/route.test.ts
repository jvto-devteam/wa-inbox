import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/get-session', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/db', () => ({ prisma: { $queryRaw: vi.fn() } }))

import { getSession } from '@/lib/auth/get-session'
import { prisma } from '@/lib/db'
import { GET } from './route'

const req = () => new Request('http://localhost/api/new/unread')

beforeEach(() => {
  vi.mocked(getSession).mockResolvedValue({ accountId: 'a1', role: 'AGENT' } as never)
  vi.mocked(prisma.$queryRaw).mockReset()
})

describe('GET /api/new/unread', () => {
  it('401 tanpa sesi', async () => {
    vi.mocked(getSession).mockResolvedValue(null as never)
    expect((await GET(req())).status).toBe(401)
  })

  it('mengembalikan jumlah percakapan belum dibaca', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ n: 7 }] as never)
    expect(await (await GET(req())).json()).toEqual({ unread: 7 })
    const sql = (vi.mocked(prisma.$queryRaw).mock.calls[0][0] as unknown as string[]).join('?')
    expect(sql).toContain(`m.direction = 'INBOUND'`)
    expect(sql).toContain('"lastReadAt"')
    expect(sql).toContain('"isTest" = false')
  })

  it('500 tanpa membocorkan galat', async () => {
    vi.mocked(prisma.$queryRaw).mockRejectedValue(new Error('postgres://rahasia'))
    const res = await GET(req())
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Gagal menghitung chat belum dibaca' })
  })
})

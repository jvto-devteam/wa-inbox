/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { verifySessionToken } from '@/lib/auth/session'
import { resolveFunnelStage } from '@/lib/pipeline/funnel'
import { GET } from './route'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))

// Fungsi ASLI tetap yang dipakai; yang ditambahkan hanya mata-mata di atasnya. Mengganti
// implementasinya akan membuat test ini hanya menguji mock-nya sendiri.
vi.mock('@/lib/pipeline/funnel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/pipeline/funnel')>()
  return { ...actual, resolveFunnelStage: vi.fn(actual.resolveFunnelStage) }
})

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

function req(withSession = true) {
  return new Request('http://localhost/api/bot-control/pipeline/funnel', {
    headers: withSession ? { cookie: 'wa_inbox_session=tok' } : {},
  })
}

function countOf(body: { stages: { id: string; count: number }[] }, id: string) {
  return body.stages.find((stage) => stage.id === id)?.count
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.mocked(resolveFunnelStage).mockClear()
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_1', role: 'AGENT', tokenVersion: 0 })
})

describe('GET /api/bot-control/pipeline/funnel', () => {
  it('menolak permintaan tanpa sesi', async () => {
    const res = await GET(req(false))
    expect(res.status).toBe(401)
  })

  // (g) dari gerbang verifikasi.
  it('sebaran funnel memakai resolveFunnelStage, bukan hitungan sendiri', async () => {
    mockPrisma.conversation.findMany.mockResolvedValue([
      // Brief lengkap TAPI bot sudah dimatikan: tangga kelengkapan mengatakan ADA_KOTA_AKHIR,
      // resolveFunnelStage mengatakan DITERUSKAN. Hitungan sendiri di UI hampir pasti memilih
      // yang pertama, jadi baris inilah yang membedakan keduanya.
      {
        id: 'conv_handoff',
        botEnabled: false,
        tripBrief: { destination: 'bromo', origin: 'jakarta', dayCount: 3, finishCity: 'malang' },
      },
      // Field bertipe salah adalah data rusak, bukan bukti percakapan berjalan: MASUK, bukan
      // TANYA. Aturan itu hidup di funnel.ts dan tidak boleh ditiru ulang di mana pun.
      { id: 'conv_rusak', botEnabled: true, tripBrief: { origin: 12 } },
      { id: 'conv_tujuan', botEnabled: true, tripBrief: { destination: 'ijen' } },
      { id: 'conv_kosong', botEnabled: true, tripBrief: null },
    ] as never)

    const res = await GET(req())
    const body = await res.json()

    expect(res.status).toBe(200)
    // Satu panggilan per percakapan, dengan fakta handoff yang ikut diserahkan — funnel.ts
    // sengaja tidak menebak itu sendiri.
    expect(vi.mocked(resolveFunnelStage)).toHaveBeenCalledTimes(4)
    expect(vi.mocked(resolveFunnelStage)).toHaveBeenCalledWith({
      tripBrief: { destination: 'bromo', origin: 'jakarta', dayCount: 3, finishCity: 'malang' },
      handedOff: true,
    })

    expect(countOf(body, 'DITERUSKAN')).toBe(1)
    expect(countOf(body, 'ADA_KOTA_AKHIR')).toBe(0)
    expect(countOf(body, 'ADA_TUJUAN')).toBe(1)
    expect(countOf(body, 'MASUK')).toBe(2)
    expect(body.total).toBe(4)
  })

  it('mengembalikan keenam tahap dalam urutan tangga meski semuanya nol', async () => {
    mockPrisma.conversation.findMany.mockResolvedValue([] as never)

    const body = await (await GET(req())).json()

    // Urutan datang dari FUNNEL_STAGES; UI tidak boleh perlu mengurutkannya sendiri.
    expect(body.stages.map((s: { id: string }) => s.id)).toEqual([
      'MASUK',
      'TANYA',
      'ADA_TUJUAN',
      'ADA_ASAL_LAMA',
      'ADA_KOTA_AKHIR',
      'DITERUSKAN',
    ])
    expect(body.stages.every((s: { count: number }) => s.count === 0)).toBe(true)
    expect(body.total).toBe(0)
  })

  it('mengabaikan percakapan sandbox dan membatasi jendelanya', async () => {
    mockPrisma.conversation.findMany.mockResolvedValue([] as never)

    await GET(req())

    const args = mockPrisma.conversation.findMany.mock.calls[0][0]
    expect(args?.where).toEqual({ isTest: false })
    expect(args?.take).toBe(500)
    expect(args?.orderBy).toEqual({ lastMessageAt: 'desc' })
  })
})

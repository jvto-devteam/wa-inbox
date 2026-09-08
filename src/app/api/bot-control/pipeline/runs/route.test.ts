/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { verifySessionToken } from '@/lib/auth/session'
import { GET } from './route'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

function req(query = '', withSession = true) {
  return new Request(`http://localhost/api/bot-control/pipeline/runs${query}`, {
    headers: withSession ? { cookie: 'wa_inbox_session=tok' } : {},
  })
}

/** Baris apa adanya dari database, termasuk kolom yang route ini TIDAK boleh teruskan. */
function runRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'run_1',
    conversationId: 'conv_1',
    messageId: 'msg_1',
    mode: 'faq',
    status: 'REPLIED',
    inboundText: 'berapa harga ijen 3d2n?',
    latencyMs: 2500,
    error: null,
    startedAt: new Date('2026-09-08T04:00:00.000Z'),
    finishedAt: new Date('2026-09-08T04:00:02.500Z'),
    steps: [
      { stepId: 'terima-pesan', status: 'selesai', at: '2026-09-08T04:00:00.000Z' },
      { stepId: 'kirim-balasan', status: 'selesai', at: '2026-09-08T04:00:02.400Z' },
    ],
    ...overrides,
  } as never
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_1', role: 'AGENT', tokenVersion: 0 })
  mockPrisma.botDecisionRun.findMany.mockResolvedValue([runRow()] as never)
  mockPrisma.conversation.findMany.mockResolvedValue([
    { id: 'conv_1', contact: { name: 'Bruno Figarola', phone: '6281234567890' } },
  ] as never)
})

describe('GET /api/bot-control/pipeline/runs', () => {
  it('menolak permintaan tanpa sesi', async () => {
    const res = await GET(req('', false))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Tidak terautentikasi' })
  })

  it('meringkas setiap run dengan kontaknya dan langkah terakhirnya', async () => {
    const body = await (await GET(req())).json()

    expect(body.items).toHaveLength(1)
    expect(body.items[0]).toMatchObject({
      id: 'run_1',
      conversationId: 'conv_1',
      contactName: 'Bruno Figarola',
      status: 'REPLIED',
      stepsRecorded: true,
      stepCount: 2,
      lastStepId: 'kirim-balasan',
      lastStepStatus: 'selesai',
    })
  })

  // (f) dari gerbang verifikasi. Temuan audit Q4 diperbaiki di route decisions; route baru ini
  // tidak boleh membuka lubang yang sama di sebelahnya.
  it('tidak mengembalikan kolom trace, dan tidak menariknya dari database', async () => {
    // Sengaja dikembalikan oleh mock: kalau route menyalin baris apa adanya, trace ikut
    // menyeberang dan test ini gagal.
    mockPrisma.botDecisionRun.findMany.mockResolvedValue([
      runRow({ trace: { rahasia: 'penalaran panjang', langkah: Array(200).fill('x') } }),
    ] as never)

    const res = await GET(req())
    const body = await res.json()

    expect(body.items[0]).not.toHaveProperty('trace')
    expect(JSON.stringify(body)).not.toContain('penalaran panjang')

    // Sisi database: `select` eksplisit dan `trace` tidak ada di dalamnya. Tanpa pengecekan
    // ini, sebuah `findMany` telanjang yang kebetulan membuang trace saat serialisasi tetap
    // memindahkan kolom terbesar tabel ini lewat kabel setiap kali halaman dibuka.
    const args = mockPrisma.botDecisionRun.findMany.mock.calls[0][0]
    const select = args?.select as Record<string, unknown> | undefined
    expect(select, 'findMany tanpa select eksplisit').toBeDefined()
    expect(select).not.toHaveProperty('trace')
    expect(select?.steps).toBe(true)
  })

  it('menyebut run tanpa jejak sebagai tidak terekam, bukan sebagai run gagal', async () => {
    mockPrisma.botDecisionRun.findMany.mockResolvedValue([runRow({ steps: null, status: 'REPLIED' })] as never)

    const body = await (await GET(req())).json()

    expect(body.items[0]).toMatchObject({ stepsRecorded: false, stepCount: 0, lastStepId: null, status: 'REPLIED' })
    expect(body.items[0].error).toBeNull()
  })

  it('menjepit limit yang tidak masuk akal alih-alih menolaknya', async () => {
    await GET(req('?limit=999'))
    expect(mockPrisma.botDecisionRun.findMany.mock.calls[0][0]?.take).toBe(50)

    mockReset(mockPrisma)
    mockPrisma.botDecisionRun.findMany.mockResolvedValue([] as never)
    await GET(req('?limit=abc'))
    expect(mockPrisma.botDecisionRun.findMany.mock.calls[0][0]?.take).toBe(20)
  })

  it('menyaring per percakapan di database, bukan di klien', async () => {
    await GET(req('?conversationId=conv_9'))
    expect(mockPrisma.botDecisionRun.findMany.mock.calls[0][0]?.where).toEqual({ conversationId: 'conv_9' })
  })

  it('tetap menjawab 200 dengan kontak kosong bila percakapannya sudah dihapus', async () => {
    mockPrisma.conversation.findMany.mockResolvedValue([] as never)

    const body = await (await GET(req())).json()

    expect(body.items[0].contactName).toBeNull()
    expect(body.items[0].contactPhone).toBeNull()
  })
})

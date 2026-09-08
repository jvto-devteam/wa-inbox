/**
 * Gerbang perilaku untuk instrumentasi kanvas pipeline (bagian B).
 *
 * File ini menguji `src/lib/inbound.ts` + tracer ASLI bersama-sama, dengan `broadcast` di-mock.
 * Yang ditegakkan bukan "kanvasnya bagus", melainkan tiga janji yang membuat instrumentasi ini
 * boleh dipasang di jalur pesan pelanggan yang hidup:
 *
 *   1. Siaran yang melempar tidak menghentikan run.
 *   2. Run yang mati di jalan keluar (bot nonaktif, rate limit, pesan non-teks, agent
 *      mengambil alih) MENUTUP step terakhirnya, tidak menggantung selamanya.
 *   3. `runId` yang disiarkan sama persis dengan `id` baris BotDecisionRun yang tersimpan --
 *      tanpa itu tampilan live dan Decision Logs adalah dua dunia yang tidak bisa dijahit.
 *
 * Untuk "tracer yang melempar tidak mengubah balasan bot", lihat file tetangganya
 * `instrumentation-tracer-rusak.test.ts` -- mock modul di vitest berlaku per-file, dan yang ini
 * justru butuh tracer asli.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { ingestMetaMessage, runBotForConversation, __resetPendingBurstsForTests } from '@/lib/inbound'
import { decideAndRespond } from '@/lib/bot/orchestrator'
import { __resetRateLimiterForTests } from '@/lib/bot/rate-limiter'
import { sendMessage } from '@/lib/send'
import { broadcast } from '@/lib/realtime'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/bot/orchestrator', () => ({ decideAndRespond: vi.fn() }))
vi.mock('@/lib/send', () => ({ sendMessage: vi.fn() }))
vi.mock('@/lib/realtime', () => ({ broadcast: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

const contactRow = { id: 'contact_1', phone: '6281234567890', name: 'Bruno', avatarUrl: 'x', avatarCheckedAt: null, source: null, createdAt: new Date() }
const conversationRow = {
  id: 'conv_1',
  contactId: 'contact_1',
  botEnabled: true,
  assignedAgentId: null,
  status: 'OPEN' as const,
  pipelineStage: 'new',
  bookingData: null,
  bookingCheckedAt: null,
  orderChannel: null,
  tripBrief: null,
  lastMessageAt: new Date(),
  lastReadAt: null,
  isPinned: false,
  isTest: false,
  createdAt: new Date(),
}

function payload(messages: Array<Record<string, unknown>>) {
  return {
    entry: [
      {
        changes: [
          {
            value: {
              contacts: [{ profile: { name: 'Bruno' }, wa_id: '6281234567890' }],
              messages: messages as never,
            },
          },
        ],
      },
    ],
  }
}

const textMessage = { id: 'wamid.ONE', from: '6281234567890', timestamp: '1700000000', type: 'text', text: { body: 'halo' } }

beforeEach(() => {
  mockReset(mockPrisma)
  vi.useFakeTimers()
  __resetPendingBurstsForTests()
  __resetRateLimiterForTests()
  vi.mocked(decideAndRespond).mockReset().mockResolvedValue({ mode: 'clarify', reply: 'Ke mana rencananya?' })
  vi.mocked(sendMessage).mockReset().mockResolvedValue({ id: 'msg_42' } as never)
  vi.mocked(broadcast).mockReset()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mockPrisma.settings.findUniqueOrThrow.mockResolvedValue({ botAutoReplyAll: true, skipBotForIndonesianNumbers: false } as never)
  mockPrisma.settings.findUnique.mockResolvedValue({ fallbackReply: null, handoffReply: null } as never)
  mockPrisma.conversation.findUnique.mockResolvedValue({ botEnabled: true } as never)
  mockPrisma.message.findUnique.mockResolvedValue(null)
  mockPrisma.contact.upsert.mockResolvedValue(contactRow as never)
  mockPrisma.conversation.upsert.mockResolvedValue(conversationRow as never)
  mockPrisma.message.create.mockResolvedValue({ id: 'msg_new' } as never)
  // Baris BotDecisionRun memantulkan id yang diberikan pemanggil, persis seperti Prisma:
  // tanpa ini, tes "runId sama dengan BotDecisionRun.id" akan lulus secara kebetulan.
  mockPrisma.botDecisionRun.create.mockImplementation((args: { data: { id?: string } }) =>
    Promise.resolve({ id: args.data.id ?? 'cuid_dari_prisma' }) as never
  )
  mockPrisma.botDecisionRun.update.mockResolvedValue({ id: 'run_1' } as never)
})

afterEach(() => {
  __resetPendingBurstsForTests()
  __resetRateLimiterForTests()
  vi.useRealTimers()
})

function pipelineEvents() {
  return vi
    .mocked(broadcast)
    .mock.calls.map(([event]) => event)
    .filter((event): event is Extract<typeof event, { type: 'pipeline.step' }> => event.type === 'pipeline.step')
}

function steps() {
  return pipelineEvents().map((event) => [event.stepId, event.status])
}

describe('gerbang: siaran yang melempar', () => {
  // Dilempar HANYA untuk event pipeline.step. Itu memang permukaan risiko yang ditambahkan
  // bagian B ini. `broadcast` yang melempar untuk `message.created` sudah bisa menggagalkan
  // ingest jauh sebelum fitur ini ada (inbound.ts memanggilnya tanpa try/catch, sengaja: sebuah
  // pesan yang gagal disiarkan berarti Meta harus mengirim ulang, bukan hilang diam-diam) --
  // itu perilaku lama yang tidak boleh diubah dari sini.
  function siarkanGagalUntukPipeline() {
    vi.mocked(broadcast).mockImplementation((event) => {
      if (event.type === 'pipeline.step') throw new Error('controller SSE sudah ditutup')
    })
  }

  it('broadcast pipeline yang melempar tidak menghentikan penanganan pesan', async () => {
    siarkanGagalUntukPipeline()

    await expect(ingestMetaMessage(payload([textMessage]))).resolves.toMatchObject({ processed: 1 })
    await vi.advanceTimersByTimeAsync(5000)

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv_1', text: 'Ke mana rencananya?', sentBy: 'BOT' })
    )
  })

  it('broadcast yang melempar untuk SEMUA event tetap tidak menghentikan run bot', async () => {
    vi.mocked(broadcast).mockImplementation(() => {
      throw new Error('controller SSE sudah ditutup')
    })

    await runBotForConversation({ id: 'conv_1', contactName: 'Bruno' }, 'halo')

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv_1', text: 'Ke mana rencananya?', sentBy: 'BOT' })
    )
  })
})

describe('gerbang: run yang berakhir di jalan keluar ditutup, tidak menggantung', () => {
  it('pesan non-teks menutup run di gerbang-bot dengan berhenti', async () => {
    await ingestMetaMessage(payload([{ id: 'wamid.IMG', from: '6281234567890', timestamp: '1700000000', type: 'image', image: { id: 'media_1', mime_type: 'image/jpeg' } }]))

    expect(steps()).toEqual([
      ['terima-pesan', 'selesai'],
      ['simpan-percakapan', 'selesai'],
      ['gerbang-bot', 'berhenti'],
    ])
    expect(pipelineEvents().at(-1)?.detail).toMatchObject({ alasan: expect.stringContaining('bukan teks') })
  })

  it('bot nonaktif untuk percakapan ini menutup run di gerbang-bot dengan berhenti', async () => {
    mockPrisma.conversation.upsert.mockResolvedValue({ ...conversationRow, botEnabled: false } as never)

    await ingestMetaMessage(payload([textMessage]))

    expect(steps().at(-1)).toEqual(['gerbang-bot', 'berhenti'])
    expect(decideAndRespond).not.toHaveBeenCalled()
  })

  it('bot dimatikan selama jeda burst menutup run di kumpulkan-burst dengan berhenti', async () => {
    // Pengecekan ulang botEnabled saat flush -- agent mengambil alih setelah pesan masuk.
    mockPrisma.conversation.findUnique.mockResolvedValue({ botEnabled: false, isTest: false } as never)

    await ingestMetaMessage(payload([textMessage]))
    await vi.advanceTimersByTimeAsync(5000)

    expect(steps().at(-1)).toEqual(['kumpulkan-burst', 'berhenti'])
    expect(decideAndRespond).not.toHaveBeenCalled()
  })

  it('rate limit percakapan menutup run di kumpulkan-burst dengan berhenti', async () => {
    mockPrisma.conversation.findUnique.mockResolvedValue({ botEnabled: true, isTest: false } as never)

    // Budget rate limit per percakapan dihabiskan lebih dulu lewat burst-burst sebelumnya.
    for (let i = 0; i < 25; i += 1) {
      mockPrisma.message.findUnique.mockResolvedValue(null)
      await ingestMetaMessage(payload([{ ...textMessage, id: `wamid.WARMUP_${i}` }]))
      await vi.advanceTimersByTimeAsync(5000)
    }
    vi.mocked(broadcast).mockClear()

    await ingestMetaMessage(payload([{ ...textMessage, id: 'wamid.BLOCKED' }]))
    await vi.advanceTimersByTimeAsync(5000)

    const terakhir = pipelineEvents().at(-1)
    expect([terakhir?.stepId, terakhir?.status]).toEqual(['kumpulkan-burst', 'berhenti'])
    expect(terakhir?.detail).toMatchObject({ alasan: expect.stringContaining('rate limit') })
  })

  it('agent mengambil alih saat bot berpikir menutup step yang masih terbuka dengan berhenti', async () => {
    // botEnabled dibaca dua kali: sekali saat flush burst (masih true), sekali setelah
    // orchestrator selesai (sudah false).
    mockPrisma.conversation.findUnique
      .mockResolvedValueOnce({ botEnabled: true, isTest: false } as never)
      .mockResolvedValue({ botEnabled: false } as never)
    // Tracer asli menandai step di dalam orchestrator; orchestrator di-mock di sini, jadi
    // step yang terbuka dibuat lewat runBotForConversation langsung.
    vi.mocked(decideAndRespond).mockImplementation(async (_id, _text, pipeline) => {
      pipeline?.mark('pahami-kebutuhan', 'mulai')
      return { mode: 'clarify', reply: 'Ke mana rencananya?' }
    })

    await ingestMetaMessage(payload([textMessage]))
    await vi.advanceTimersByTimeAsync(5000)

    expect(steps().at(-1)).toEqual(['pahami-kebutuhan', 'berhenti'])
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('orchestrator yang melempar menutup step terbuka dengan gagal, dan error tetap dilempar ulang', async () => {
    vi.mocked(decideAndRespond).mockImplementation(async (_id, _text, pipeline) => {
      pipeline?.mark('cek-eskalasi', 'mulai')
      throw new Error('ollama mati')
    })

    await expect(runBotForConversation({ id: 'conv_1', contactName: 'Bruno' }, 'halo')).rejects.toThrow('ollama mati')

    expect(steps().at(-1)).toEqual(['cek-eskalasi', 'gagal'])
  })
})

describe('gerbang: runId live sama dengan BotDecisionRun.id', () => {
  it('id baris yang tersimpan sama persis dengan runId yang disiarkan', async () => {
    await ingestMetaMessage(payload([textMessage]))
    await vi.advanceTimersByTimeAsync(5000)

    const runIds = new Set(pipelineEvents().map((event) => event.runId))
    expect(runIds.size).toBe(1)

    const created = mockPrisma.botDecisionRun.create.mock.calls[0][0].data as { id?: string }
    expect(created.id).toBe([...runIds][0])
    // Dan `id` itu benar-benar dipakai untuk menautkan pesan, bukan cuid lain dari Prisma.
    expect(mockPrisma.botDecisionRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: created.id } })
    )
  })

  it('jejak step ikut tersimpan pada penulisan BotDecisionRun yang memang sudah terjadi', async () => {
    await ingestMetaMessage(payload([textMessage]))
    await vi.advanceTimersByTimeAsync(5000)

    // Satu create + satu update -- tidak ada query ketiga yang ditambahkan demi kanvas.
    expect(mockPrisma.botDecisionRun.create).toHaveBeenCalledTimes(1)
    expect(mockPrisma.botDecisionRun.update).toHaveBeenCalledTimes(1)

    const created = mockPrisma.botDecisionRun.create.mock.calls[0][0].data as { steps?: Array<{ stepId: string }> }
    expect(created.steps?.map((s) => s.stepId)).toContain('gerbang-bot')

    // Dua langkah terakhir baru ada SETELAH pesan terkirim, jadi mereka menumpang UPDATE-nya.
    const updated = mockPrisma.botDecisionRun.update.mock.calls[0][0].data as { steps?: Array<{ stepId: string }> }
    expect(updated.steps?.map((s) => s.stepId)).toContain('kirim-balasan')
  })
})

describe('gerbang: rahasia tidak pernah keluar lewat detail step', () => {
  const TOKEN = 'EAAGm0PX4ZCpsBO1234567890abcdefghijklmnop'

  it('detail yang menyerupai token tidak tersiar mentah dan tidak tersimpan mentah', async () => {
    vi.mocked(decideAndRespond).mockImplementation(async (_id, _text, pipeline) => {
      pipeline?.mark('susun-balasan', 'mulai', { accessToken: TOKEN, catatan: `gagal: access_token=${TOKEN}` })
      return { mode: 'clarify', reply: 'Ke mana rencananya?' }
    })

    await ingestMetaMessage(payload([textMessage]))
    await vi.advanceTimersByTimeAsync(5000)

    const disiarkan = JSON.stringify(pipelineEvents())
    expect(disiarkan).not.toContain(TOKEN)
    expect(disiarkan).toContain('[REDACTED]')

    const tersimpan = JSON.stringify(mockPrisma.botDecisionRun.update.mock.calls[0][0].data)
    expect(tersimpan).not.toContain(TOKEN)
  })
})

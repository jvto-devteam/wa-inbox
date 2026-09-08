/**
 * Gerbang perilaku yang paling penting dari bagian B: TRACER YANG SELALU MELEMPAR TIDAK BOLEH
 * MENGUBAH APA PUN.
 *
 * Seluruh modul `@/lib/pipeline/tracer` diganti dengan versi bermusuhan: setiap fungsi helper
 * yang dipanggil `inbound.ts` melempar, `openPipelineRun` melempar, dan tracer yang dipegang
 * pun melempar di setiap metodenya. Lalu alur inbound dijalankan ujung-ke-ujung, dan yang
 * ditegakkan adalah balasan yang IDENTIK dengan alur tanpa instrumentasi sama sekali:
 * teks yang sama, mode yang sama, handoff yang sama, botEnabled yang sama, audit yang sama.
 *
 * Kenapa file terpisah: `vi.mock` berlaku per-file, dan tetangganya (`instrumentation.test.ts`)
 * justru harus memakai tracer asli.
 *
 * Kenapa helper-nya ikut dibuat melempar, bukan cuma tracer-nya: karena itulah kontraknya.
 * `inbound.ts`/`orchestrator.ts` sengaja TIDAK pernah memanggil `tracer.mark(...)` langsung --
 * semuanya lewat traceStep/traceClose/traceSnapshot/traceRunId. Kalau salah satu call site
 * lupa dan memanggil metodenya langsung, tracer bermusuhan di bawah akan menjatuhkan test ini.
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
vi.mock('@/lib/pipeline/tracer', async (importActual) => {
  const asli = await importActual<typeof import('@/lib/pipeline/tracer')>()
  function meledak(): never {
    throw new Error('instrumentasi rusak total')
  }
  // Sebuah tracer yang setiap metode DAN setiap propertinya melempar. Helper terlindung
  // (traceStep/traceClose/traceSnapshot/traceRunId) sengaja TIDAK di-mock: merekalah kontrak
  // yang sedang diuji di sini, dan merekalah satu-satunya cara jalur panas menyentuh tracer.
  const tracerBermusuhan = {
    get runId(): string {
      return meledak()
    },
    get conversationId(): string {
      return meledak()
    },
    mark: meledak,
    closeOpen: meledak,
    snapshot: meledak,
  }
  return { ...asli, openPipelineRun: () => tracerBermusuhan, createNoopPipelineTracer: () => tracerBermusuhan }
})

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

const textMessage = { id: 'wamid.ONE', from: '6281234567890', timestamp: '1700000000', type: 'text', text: { body: 'halo' } }
const samplePayload = {
  entry: [
    {
      changes: [
        {
          value: {
            contacts: [{ profile: { name: 'Bruno' }, wa_id: '6281234567890' }],
            messages: [textMessage] as never,
          },
        },
      ],
    },
  ],
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.useFakeTimers()
  __resetPendingBurstsForTests()
  __resetRateLimiterForTests()
  vi.mocked(decideAndRespond).mockReset().mockResolvedValue({ mode: 'faq', draft: 'Ijen aman kok.', sourceTopic: 'safety' })
  vi.mocked(sendMessage).mockReset().mockResolvedValue({ id: 'msg_42' } as never)
  vi.mocked(broadcast).mockReset()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mockPrisma.settings.findUniqueOrThrow.mockResolvedValue({ botAutoReplyAll: true, skipBotForIndonesianNumbers: false } as never)
  mockPrisma.settings.findUnique.mockResolvedValue({ fallbackReply: null, handoffReply: null } as never)
  mockPrisma.conversation.findUnique.mockResolvedValue({ botEnabled: true, isTest: false } as never)
  mockPrisma.message.findUnique.mockResolvedValue(null)
  mockPrisma.contact.upsert.mockResolvedValue(contactRow as never)
  mockPrisma.conversation.upsert.mockResolvedValue(conversationRow as never)
  mockPrisma.message.create.mockResolvedValue({ id: 'msg_new' } as never)
  mockPrisma.botDecisionRun.create.mockResolvedValue({ id: 'run_1' } as never)
  mockPrisma.botDecisionRun.update.mockResolvedValue({ id: 'run_1' } as never)
})

afterEach(() => {
  __resetPendingBurstsForTests()
  __resetRateLimiterForTests()
  vi.useRealTimers()
})

describe('tracer yang selalu melempar', () => {
  it('pesan tetap masuk, tersiar ke inbox, dan dilaporkan sebagai processed', async () => {
    await expect(ingestMetaMessage(samplePayload)).resolves.toEqual({
      processed: 1,
      skipped: 0,
      statusUpdates: 0,
      templateStatusUpdates: 0,
      echoed: 0,
    })
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ type: 'message.created', conversationId: 'conv_1' }))
  })

  it('bot tetap dipanggil dan balasannya identik dengan alur tanpa instrumentasi', async () => {
    await ingestMetaMessage(samplePayload)
    await vi.advanceTimersByTimeAsync(5000)

    expect(decideAndRespond).toHaveBeenCalledTimes(1)
    expect(vi.mocked(decideAndRespond).mock.calls[0].slice(0, 2)).toEqual(['conv_1', 'halo'])
    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(sendMessage).toHaveBeenCalledWith({
      conversationId: 'conv_1',
      text: 'Ijen aman kok.',
      sentBy: 'BOT',
      botTrace: { mode: 'faq', draft: 'Ijen aman kok.', sourceTopic: 'safety' },
    })
  })

  it('burst tetap digabung menjadi SATU keputusan, bukan satu balasan per fragmen', async () => {
    await ingestMetaMessage({
      entry: [
        {
          changes: [
            {
              value: {
                contacts: [{ profile: { name: 'Bruno' }, wa_id: '6281234567890' }],
                messages: [
                  textMessage,
                  { id: 'wamid.TWO', from: '6281234567890', timestamp: '1700000005', type: 'text', text: { body: 'is ijen safe?' } },
                ] as never,
              },
            },
          ],
        },
      ],
    })
    await vi.advanceTimersByTimeAsync(5000)

    expect(decideAndRespond).toHaveBeenCalledTimes(1)
    expect(vi.mocked(decideAndRespond).mock.calls[0].slice(0, 2)).toEqual(['conv_1', 'halo\nis ijen safe?'])
    expect(sendMessage).toHaveBeenCalledTimes(1)
  })

  it('handoff tetap mengirim pengakuan generik, mematikan botEnabled, dan menyiarkan handoff.alert', async () => {
    vi.mocked(decideAndRespond).mockResolvedValue({ mode: 'handoff', reason: 'Kata kunci eskalasi terdeteksi' })

    await runBotForConversation({ id: 'conv_1', contactName: 'Bruno' }, 'saya mau komplain')

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv_1',
        text: "Thank you for your message! I'm connecting you with a member of our team, and they'll follow up with you shortly.",
        sentBy: 'BOT',
      })
    )
    expect(mockPrisma.conversation.update).toHaveBeenCalledWith({ where: { id: 'conv_1' }, data: { botEnabled: false } })
    expect(broadcast).toHaveBeenCalledWith({ type: 'handoff.alert', conversationId: 'conv_1', contactName: 'Bruno' })
  })

  it('audit BotDecisionRun tetap ditulis, hanya tanpa id dan tanpa jejak step', async () => {
    await runBotForConversation({ id: 'conv_1', contactName: 'Bruno' }, 'halo')

    expect(mockPrisma.botDecisionRun.create).toHaveBeenCalledTimes(1)
    const data = mockPrisma.botDecisionRun.create.mock.calls[0][0].data as { id?: string; steps?: unknown; status: string }
    // `id` tidak ikut, jadi Prisma tetap membuat cuid()-nya sendiri -- persis perilaku sebelum
    // fitur ini ada. Bukan id kosong, bukan crash.
    expect(data.id).toBeUndefined()
    expect(data.steps).toBeUndefined()
    expect(data.status).toBe('REPLIED')
  })

  it('agent yang mengambil alih saat bot berpikir tetap membatalkan pengiriman', async () => {
    mockPrisma.conversation.findUnique.mockResolvedValue({ botEnabled: false } as never)

    await runBotForConversation({ id: 'conv_1', contactName: 'Bruno' }, 'halo')

    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('orchestrator yang melempar tetap dilempar ulang tanpa berubah', async () => {
    vi.mocked(decideAndRespond).mockRejectedValue(new Error('ollama mati'))

    await expect(runBotForConversation({ id: 'conv_1', contactName: 'Bruno' }, 'halo')).rejects.toThrow('ollama mati')
    expect(mockPrisma.botDecisionRun.create).toHaveBeenCalledTimes(1)
  })

  it('pesan non-teks tetap tidak memicu bot maupun handoff', async () => {
    await ingestMetaMessage({
      entry: [
        {
          changes: [
            {
              value: {
                contacts: [{ profile: { name: 'Bruno' }, wa_id: '6281234567890' }],
                messages: [{ id: 'wamid.IMG', from: '6281234567890', timestamp: '1700000000', type: 'image', image: { id: 'media_1', mime_type: 'image/jpeg' } }] as never,
              },
            },
          ],
        },
      ],
    })
    await vi.advanceTimersByTimeAsync(5000)

    expect(decideAndRespond).not.toHaveBeenCalled()
    expect(broadcast).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'handoff.alert' }))
  })
})

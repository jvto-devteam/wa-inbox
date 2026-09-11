/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { broadcast } from '@/lib/realtime'
import { classifyTopicViaLLM, type TopicClassification } from '@/lib/bot/topic-classifier'
import { classifyAllTopics } from '@/lib/bot/multi-topic-classifier'
import { classifySalesNeed } from '@/lib/bot/sales-classifier'
import { classifyAndStoreTopicLabels } from './topic-labels'
import { readTopicLabels } from './topic-labels-schema'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/realtime', () => ({ broadcast: vi.fn() }))
vi.mock('@/lib/bot/topic-classifier', () => ({ classifyTopicViaLLM: vi.fn() }))
vi.mock('@/lib/bot/multi-topic-classifier', () => ({ classifyAllTopics: vi.fn() }))
vi.mock('@/lib/bot/sales-classifier', () => ({ classifySalesNeed: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

const TEXT = 'Berapa harga paket Ijen untuk 2 orang?'
const inbound = { id: 'msg_1', conversationId: 'conv_1', direction: 'INBOUND', content: TEXT }

function updateArg() {
  return mockPrisma.message.update.mock.calls[0][0]
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.clearAllMocks()
  mockPrisma.message.findUnique.mockResolvedValue(inbound as never)
  mockPrisma.settings.findUnique.mockResolvedValue({ ollamaModel: 'gemma4:31b-cloud' } as never)
  mockPrisma.message.update.mockResolvedValue({
    ...inbound,
    mediaId: null,
    mediaUrl: null,
    replyTo: null,
  } as never)
  vi.mocked(classifyTopicViaLLM).mockResolvedValue({ topic: 'price', source: 'llm' })
  vi.mocked(classifyAllTopics).mockResolvedValue(['price', 'payment'])
  vi.mocked(classifySalesNeed).mockReturnValue({ job: 'J2', missingInfo: [], needsLiveData: false })
})

describe('classifyAndStoreTopicLabels', () => {
  it('menyimpan label dengan source yang diminta, dan membuang topik utama dari alsoTopics', async () => {
    const labels = await classifyAndStoreTopicLabels('msg_1', 'auto')

    expect(labels).toEqual({
      topic: 'price',
      alsoTopics: ['payment'],
      job: 'J2',
      topicSource: 'llm',
      source: 'auto',
      at: expect.any(String),
    })
    expect(updateArg()).toMatchObject({ where: { id: 'msg_1' }, data: { topicLabels: labels } })
    expect(classifySalesNeed).toHaveBeenCalledWith({ message: TEXT, tripBrief: {} })
  })

  it('mencatat source manual apa adanya', async () => {
    const labels = await classifyAndStoreTopicLabels('msg_1', 'manual')
    expect(labels?.source).toBe('manual')
  })

  it('memakai Settings.ollamaModel untuk kedua classifier model, dan menjalankannya paralel', async () => {
    let release: (value: TopicClassification) => void = () => {}
    vi.mocked(classifyTopicViaLLM).mockReturnValue(
      new Promise<TopicClassification>((resolve) => {
        release = resolve
      })
    )

    const pending = classifyAndStoreTopicLabels('msg_1', 'auto')
    // classifyAllTopics sudah dipanggil sementara classifyTopicViaLLM belum selesai.
    await vi.waitFor(() => expect(classifyAllTopics).toHaveBeenCalledWith(TEXT, 'gemma4:31b-cloud'))
    release({ topic: 'price', source: 'llm' })
    await pending

    expect(classifyTopicViaLLM).toHaveBeenCalledWith(null, TEXT, 'gemma4:31b-cloud')
  })

  it('mencatat topicSource regex_fallback', async () => {
    vi.mocked(classifyTopicViaLLM).mockResolvedValue({ topic: 'payment', source: 'regex_fallback' })

    const labels = await classifyAndStoreTopicLabels('msg_1', 'auto')

    expect(labels).toMatchObject({ topic: 'payment', alsoTopics: ['price'], topicSource: 'regex_fallback' })
  })

  it('memancarkan message.updated berisi baris tersimpan', async () => {
    await classifyAndStoreTopicLabels('msg_1', 'auto')

    expect(broadcast).toHaveBeenCalledWith({
      type: 'message.updated',
      conversationId: 'conv_1',
      message: expect.objectContaining({ id: 'msg_1', mediaUrl: null }),
    })
  })

  it('tidak mengklasifikasi pesan yang tidak ada, pesan keluar, atau pesan tanpa teks', async () => {
    for (const row of [null, { ...inbound, direction: 'OUTBOUND' }, { ...inbound, content: '   ' }, { ...inbound, content: null }]) {
      mockPrisma.message.findUnique.mockResolvedValueOnce(row as never)
      expect(await classifyAndStoreTopicLabels('msg_1', 'auto')).toBeNull()
    }
    expect(classifyTopicViaLLM).not.toHaveBeenCalled()
    expect(mockPrisma.message.update).not.toHaveBeenCalled()
  })

  it('galat baca dicatat tanpa teks pelanggan, tidak melempar, dan tidak memancarkan apa pun', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockPrisma.message.findUnique.mockRejectedValue(new Error('db down'))

    await expect(classifyAndStoreTopicLabels('msg_1', 'auto')).resolves.toBeNull()

    expect(errorSpy).toHaveBeenCalledWith(
      'classifyAndStoreTopicLabels gagal',
      expect.objectContaining({ messageId: 'msg_1', source: 'auto' })
    )
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('Berapa harga')
    expect(broadcast).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('galat simpan dicatat, tidak melempar, dan tidak memancarkan apa pun', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockPrisma.message.update.mockRejectedValue(new Error('db down'))

    await expect(classifyAndStoreTopicLabels('msg_1', 'manual')).resolves.toBeNull()

    expect(errorSpy).toHaveBeenCalledWith('classifyAndStoreTopicLabels gagal', expect.objectContaining({ source: 'manual' }))
    expect(broadcast).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})

describe('readTopicLabels', () => {
  const valid = {
    topic: 'price',
    alsoTopics: ['payment'],
    job: 'J2',
    topicSource: 'llm',
    source: 'auto',
    at: '2026-09-11T08:00:00.000Z',
  }

  it('menerima bentuk yang valid', () => {
    expect(readTopicLabels(valid)).toEqual(valid)
  })

  it('menolak null dan bentuk yang tidak dikenal build ini', () => {
    expect(readTopicLabels(null)).toBeNull()
    expect(readTopicLabels({ ...valid, topic: 'bukan_topik' })).toBeNull()
    expect(readTopicLabels({ ...valid, job: 'J9' })).toBeNull()
    expect(readTopicLabels({ ...valid, source: 'robot' })).toBeNull()
  })
})

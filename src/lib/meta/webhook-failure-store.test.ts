/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { createHash } from 'node:crypto'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/inbound', () => ({ ingestMetaMessage: vi.fn() }))

import { prisma } from '@/lib/db'
import { ingestMetaMessage } from '@/lib/inbound'
import { REPLAY_PER_TICK, REPLAY_WINDOW_MS, RETENTION_MS, RETRY_EVERY_MS, replayWebhookFailures, saveWebhookFailure } from './webhook-failure-store'

const db = prisma as unknown as DeepMockProxy<PrismaClient>
const NOW = new Date('2026-11-27T08:00:00Z')
const row = (id: string, body = '{"entry":[]}') => ({ id, bodyHash: id, body, error: 'x', attempts: 0, createdAt: new Date(NOW.getTime() - 60_000), lastAttemptAt: null, processedAt: null })

beforeEach(() => {
  mockReset(db)
  vi.mocked(ingestMetaMessage).mockReset().mockResolvedValue({ processed: 1, skipped: 0, statusUpdates: 0, templateStatusUpdates: 0, echoed: 0 })
  vi.spyOn(console, 'error').mockImplementation(() => {})
  db.webhookFailure.deleteMany.mockResolvedValue({ count: 0 })
  db.webhookFailure.update.mockResolvedValue({} as never)
})

describe('saveWebhookFailure', () => {
  it('satu baris per isi unik (hash SHA-256); kiriman ulang yang sama hanya menyegarkan galatnya', async () => {
    await saveWebhookFailure('{"a":1}', new Error('boom 6281234567890 a@b.co'))
    const hash = createHash('sha256').update('{"a":1}').digest('hex')
    expect(db.webhookFailure.upsert).toHaveBeenCalledWith({
      where: { bodyHash: hash },
      create: { bodyHash: hash, body: '{"a":1}', error: 'Error: boom … …' },
      update: { error: 'Error: boom … …' },
    })
  })

  it('tidak pernah melempar', async () => {
    db.webhookFailure.upsert.mockRejectedValue(new Error('db'))
    await expect(saveWebhookFailure('{}', 'x')).resolves.toBeUndefined()
  })
})

describe('replayWebhookFailures', () => {
  it('memproses ulang yang belum selesai: jendela 7 hari, jeda 15 menit, tertua dulu, maks. 20 per tick', async () => {
    db.webhookFailure.findMany.mockResolvedValue([])
    await replayWebhookFailures(NOW)
    expect(db.webhookFailure.findMany).toHaveBeenCalledWith({
      where: {
        processedAt: null,
        createdAt: { gte: new Date(NOW.getTime() - REPLAY_WINDOW_MS) },
        OR: [{ lastAttemptAt: null }, { lastAttemptAt: { lte: new Date(NOW.getTime() - RETRY_EVERY_MS) } }],
      },
      orderBy: { createdAt: 'asc' },
      take: REPLAY_PER_TICK,
    })
  })

  it('berhasil = ditandai selesai; gagal = dicoba lagi nanti, tidak menghentikan yang lain', async () => {
    db.webhookFailure.findMany.mockResolvedValue([row('a', '{"entry":[1]}'), row('b'), row('c')] as never)
    vi.mocked(ingestMetaMessage).mockResolvedValueOnce({ processed: 1, skipped: 0, statusUpdates: 0, templateStatusUpdates: 0, echoed: 0 }).mockRejectedValueOnce(new Error('masih rusak')).mockResolvedValueOnce({ processed: 0, skipped: 1, statusUpdates: 0, templateStatusUpdates: 0, echoed: 0 })
    expect(await replayWebhookFailures(NOW)).toEqual({ replayed: 2, failed: 1, pruned: 0 })
    expect(ingestMetaMessage).toHaveBeenNthCalledWith(1, { entry: [1] })
    expect(db.webhookFailure.update).toHaveBeenCalledWith({ where: { id: 'a' }, data: { processedAt: NOW, lastAttemptAt: NOW, attempts: { increment: 1 } } })
    expect(db.webhookFailure.update).toHaveBeenCalledWith({ where: { id: 'b' }, data: expect.objectContaining({ lastAttemptAt: NOW, error: 'Error: masih rusak' }) })
    expect(db.webhookFailure.update).toHaveBeenCalledWith({ where: { id: 'c' }, data: expect.objectContaining({ processedAt: NOW }) })
  })

  it('isi yang bukan JSON dihitung gagal, bukan melempar', async () => {
    db.webhookFailure.findMany.mockResolvedValue([row('x', 'bukan json')] as never)
    expect(await replayWebhookFailures(NOW)).toMatchObject({ replayed: 0, failed: 1 })
  })

  it('memangkas yang lebih tua dari 30 hari', async () => {
    db.webhookFailure.findMany.mockResolvedValue([])
    db.webhookFailure.deleteMany.mockResolvedValue({ count: 3 })
    expect(await replayWebhookFailures(NOW)).toEqual({ replayed: 0, failed: 0, pruned: 3 })
    expect(db.webhookFailure.deleteMany).toHaveBeenCalledWith({ where: { createdAt: { lt: new Date(NOW.getTime() - RETENTION_MS) } } })
  })

  it('tidak pernah melempar', async () => {
    db.webhookFailure.findMany.mockRejectedValue(new Error('db'))
    await expect(replayWebhookFailures(NOW)).resolves.toEqual({ replayed: 0, failed: 0, pruned: 0 })
  })
})

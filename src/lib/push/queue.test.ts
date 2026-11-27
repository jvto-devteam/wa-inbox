/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/call-escalation/escalate', () => ({ armCallEscalation: vi.fn().mockResolvedValue(undefined) }))
vi.mock('./send', async (orig) => ({ ...(await orig<typeof import('./send')>()), sendPushToAll: vi.fn().mockResolvedValue(undefined) }))

import { prisma } from '@/lib/db'
import { armCallEscalation } from '@/lib/call-escalation/escalate'
import { sendPushToAll } from './send'
import { MAX_REPEATS, MAX_SINGLE_PER_TICK, REPEAT_EVERY_MS, buildQueueItemPayload, pushFollowUpDigest, pushNewQueueItems } from './queue'

const db = prisma as unknown as DeepMockProxy<PrismaClient>
const ANCHOR = new Date('2026-11-27T03:05:00Z') // 10.05 WIB
const NOW = new Date('2026-11-27T04:00:00Z') // 11.00 WIB
const item = (id: string, o: { kind?: string; anchorAt?: Date; pushedFor?: Date | null; name?: string | null; pushCount?: number; pushedAt?: Date | null } = {}) => ({
  id,
  kind: o.kind ?? 'REPLY',
  conversationId: `c-${id}`,
  anchorAt: o.anchorAt ?? ANCHOR,
  anchorMessageId: `m-${id}`,
  pushedFor: o.pushedFor ?? null,
  pushCount: o.pushCount ?? 0,
  pushedAt: o.pushedAt ?? null,
  conversation: { contact: { name: o.name === undefined ? 'Sophie' : o.name } },
})
const payloads = () => vi.mocked(sendPushToAll).mock.calls.map((c) => c[0])

beforeEach(() => {
  mockReset(db)
  vi.mocked(sendPushToAll).mockClear()
  vi.mocked(armCallEscalation).mockClear()
  db.summaryItem.updateMany.mockResolvedValue({ count: 1 })
})

describe('buildQueueItemPayload', () => {
  it('Balas: nama kontak + jam WIB, tanpa teks pesan; ketuk membuka pesan anchor', () => {
    const p = buildQueueItemPayload({ id: 'i1', kind: 'REPLY', conversationId: 'c1', anchorAt: ANCHOR, anchorMessageId: 'm1', contactName: 'Sophie' })
    expect(p).toEqual({ title: 'Belum dibalas: Sophie', body: 'Menunggu balasan sejak 10.05 WIB — ketuk untuk membalas', url: '/inbox?conversation=c1&message=m1', tag: 'summary-item:i1' })
  })

  it('Janji Admin; nama yang berupa nomor HP disaring, tanpa nama = "Pelanggan"', () => {
    expect(buildQueueItemPayload({ id: 'i2', kind: 'PROMISE', conversationId: 'c2', anchorAt: ANCHOR, anchorMessageId: null, contactName: '+62 812-3456-7890' }).title).not.toMatch(/812/)
    expect(buildQueueItemPayload({ id: 'i2', kind: 'PROMISE', conversationId: 'c2', anchorAt: ANCHOR, anchorMessageId: null, contactName: null })).toMatchObject({ title: 'Janji Admin: Pelanggan', url: '/inbox?conversation=c2' })
  })
})

describe('pushNewQueueItems', () => {
  it('hanya REPLY/PROMISE OPEN yang anchor-nya belum dikabarkan; klaim bersyarat sebelum kirim', async () => {
    db.summaryItem.findMany.mockResolvedValue([item('a'), item('b', { pushedFor: ANCHOR }), item('c', { kind: 'PROMISE', pushedFor: new Date(ANCHOR.getTime() - 1) })] as never)
    expect(await pushNewQueueItems(NOW)).toEqual({ sent: 2 })
    expect(db.summaryItem.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { state: 'OPEN', kind: { in: ['REPLY', 'PROMISE'] } } }))
    expect(db.summaryItem.updateMany).toHaveBeenCalledWith({ where: { id: 'a', state: 'OPEN', pushedFor: null, anchorAt: ANCHOR }, data: { pushedFor: ANCHOR, pushCount: 1, pushedAt: NOW } })
    expect(payloads().map((p) => p.tag)).toEqual(['summary-item:a', 'summary-item:c'])
    expect(payloads()[1].title).toBe('Janji Admin: Sophie')
  })

  it('klaim kalah (tick lain sudah mengirim / item tertutup) = tidak dikirim', async () => {
    db.summaryItem.findMany.mockResolvedValue([item('a')] as never)
    db.summaryItem.updateMany.mockResolvedValue({ count: 0 })
    expect(await pushNewQueueItems(NOW)).toEqual({ sent: 0 })
    expect(sendPushToAll).not.toHaveBeenCalled()
  })

  it('banyak sekaligus: lima pertama satu per item, sisanya digabung satu push', async () => {
    const many = Array.from({ length: MAX_SINGLE_PER_TICK + 3 }, (_, n) => item(`i${n}`, { kind: n === MAX_SINGLE_PER_TICK + 2 ? 'PROMISE' : 'REPLY' }))
    db.summaryItem.findMany.mockResolvedValue(many as never)
    expect(await pushNewQueueItems(NOW)).toEqual({ sent: MAX_SINGLE_PER_TICK + 1 })
    expect(payloads().at(-1)).toEqual({ title: '3 chat lain di Antrean', body: '2 belum dibalas · 1 janji admin — ketuk untuk membuka Antrean', url: '/antrean', tag: 'queue-batch' })
  })

  it('tidak pernah melempar', async () => {
    db.summaryItem.findMany.mockRejectedValue(new Error('db'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(pushNewQueueItems(NOW)).resolves.toEqual({ sent: 0 })
  })
})

describe('eskalasi telepon (owner 2026-11-27)', () => {
  it('notif PERTAMA kartu Balas didaftarkan; Janji Admin dan pengingat ulang tidak', async () => {
    db.summaryItem.findMany.mockResolvedValue([
      item('a'),
      item('p', { kind: 'PROMISE' }),
      item('r', { pushedFor: ANCHOR, pushCount: 1, pushedAt: new Date(NOW.getTime() - REPEAT_EVERY_MS) }),
    ] as never)
    await pushNewQueueItems(NOW)
    expect(sendPushToAll).toHaveBeenCalledTimes(3)
    expect(armCallEscalation).toHaveBeenCalledTimes(1)
    expect(armCallEscalation).toHaveBeenCalledWith({ kind: 'REPLY', conversationId: 'c-a', itemId: 'a', anchorAt: ANCHOR }, NOW)
  })

  it('yang digabung dalam satu notif (lebih dari 5 sekaligus) tetap didaftarkan', async () => {
    db.summaryItem.findMany.mockResolvedValue(Array.from({ length: MAX_SINGLE_PER_TICK + 2 }, (_, n) => item(`i${n}`)) as never)
    await pushNewQueueItems(NOW)
    expect(armCallEscalation).toHaveBeenCalledTimes(MAX_SINGLE_PER_TICK + 2)
  })
})

describe('pengingat ulang Belum dibalas (owner 2026-11-27: tiap 1 jam, maks. 3 kali)', () => {
  const HOUR = REPEAT_EVERY_MS

  it('REPLY yang masih OPEN ≥ 1 jam sejak push terakhir diingatkan lagi, tag sama (menggantikan notif lama)', async () => {
    db.summaryItem.findMany.mockResolvedValue([item('a', { pushedFor: ANCHOR, pushCount: 1, pushedAt: new Date(NOW.getTime() - HOUR) })] as never)
    expect(await pushNewQueueItems(NOW)).toEqual({ sent: 1 })
    expect(db.summaryItem.updateMany).toHaveBeenCalledWith({ where: { id: 'a', state: 'OPEN', pushedFor: ANCHOR, anchorAt: ANCHOR, pushCount: 1 }, data: { pushedFor: ANCHOR, pushCount: 2, pushedAt: NOW } })
    expect(payloads()[0]).toEqual({
      title: 'Masih belum dibalas: Sophie',
      body: 'Menunggu sejak 10.05 WIB (± 1 jam) · pengingat 1/3 — ketuk untuk membalas',
      url: '/inbox?conversation=c-a&message=m-a',
      tag: 'summary-item:a',
    })
  })

  it('belum 1 jam, ulangan habis (4 notif), Janji Admin, atau baris lama tanpa hitungan = tidak diulang', async () => {
    db.summaryItem.findMany.mockResolvedValue([
      item('early', { pushedFor: ANCHOR, pushCount: 1, pushedAt: new Date(NOW.getTime() - HOUR + 60_000) }),
      item('done', { pushedFor: ANCHOR, pushCount: MAX_REPEATS + 1, pushedAt: new Date(NOW.getTime() - 5 * HOUR) }),
      item('promise', { kind: 'PROMISE', pushedFor: ANCHOR, pushCount: 1, pushedAt: new Date(NOW.getTime() - 5 * HOUR) }),
      item('legacy', { pushedFor: ANCHOR, pushCount: 0, pushedAt: null }),
    ] as never)
    expect(await pushNewQueueItems(NOW)).toEqual({ sent: 0 })
    expect(db.summaryItem.updateMany).not.toHaveBeenCalled()
  })

  it('ulangan terakhir = pengingat 3/3; sesudahnya berhenti', async () => {
    db.summaryItem.findMany.mockResolvedValue([item('a', { pushedFor: ANCHOR, pushCount: MAX_REPEATS, pushedAt: new Date(NOW.getTime() - HOUR) })] as never)
    await pushNewQueueItems(NOW)
    expect(payloads()[0].body).toContain('pengingat 3/3')
    expect(db.summaryItem.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ pushCount: MAX_REPEATS + 1 }) }))
  })

  it('anchor baru (tamu chat lagi sesudah ditutup) mulai dari notif pertama lagi', async () => {
    const later = new Date(ANCHOR.getTime() + 3 * HOUR)
    db.summaryItem.findMany.mockResolvedValue([item('a', { anchorAt: later, pushedFor: ANCHOR, pushCount: MAX_REPEATS + 1, pushedAt: new Date(NOW.getTime() - 60_000) })] as never)
    await pushNewQueueItems(NOW)
    expect(payloads()[0].title).toBe('Belum dibalas: Sophie')
    expect(db.summaryItem.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { pushedFor: later, pushCount: 1, pushedAt: NOW } }))
  })
})

describe('pushFollowUpDigest', () => {
  const at = (wib: string) => new Date(`2026-11-27T${wib}:00+07:00`)

  it('sebelum 08:00 WIB ditahan, tanpa membaca DB', async () => {
    expect(await pushFollowUpDigest(at('07:55'))).toEqual({ sent: 0 })
    expect(db.summaryItem.findMany).not.toHaveBeenCalled()
  })

  it('mulai 08:00 WIB: satu push merangkum Follow Up baru, ditandai supaya tidak diulang', async () => {
    db.summaryItem.findMany.mockResolvedValue([item('f1', { kind: 'FOLLOW_UP' }), item('f2', { kind: 'FOLLOW_UP' })] as never)
    db.summaryItem.count.mockResolvedValue(6)
    expect(await pushFollowUpDigest(at('08:00'))).toEqual({ sent: 1 })
    expect(db.summaryItem.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { state: 'OPEN', kind: { in: ['FOLLOW_UP'] } } }))
    expect(db.summaryItem.updateMany).toHaveBeenCalledTimes(2)
    expect(payloads()).toEqual([{ title: 'Follow up hari ini', body: '2 chat perlu follow up (total 6 terbuka) — ketuk untuk membuka Antrean', url: '/antrean', tag: 'follow-up-digest' }])
  })

  it('tidak ada Follow Up baru = tidak ada push', async () => {
    db.summaryItem.findMany.mockResolvedValue([item('f1', { kind: 'FOLLOW_UP', pushedFor: ANCHOR })] as never)
    expect(await pushFollowUpDigest(at('09:00'))).toEqual({ sent: 0 })
    expect(sendPushToAll).not.toHaveBeenCalled()
  })
})

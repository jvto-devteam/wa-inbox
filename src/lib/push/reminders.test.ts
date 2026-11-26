/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('./send', async (orig) => ({ ...(await orig<typeof import('./send')>()), sendPushToAll: vi.fn().mockResolvedValue(undefined) }))

import { prisma } from '@/lib/db'
import { sendPushToAll } from './send'
import { MAX_LATE_MS, buildReminderPayload, pushDueReminders } from './reminders'

const db = prisma as unknown as DeepMockProxy<PrismaClient>
const NOW = new Date('2026-11-26T03:00:00Z')
const rem = (id: string, o: { dueAt?: Date; pushedFor?: Date | null; name?: string | null; conv?: string | null; note?: string } = {}) => ({
  id,
  note: o.note ?? 'Kirim quotation 5 orang',
  dueAt: o.dueAt ?? new Date(NOW.getTime() - 60_000),
  pushedFor: o.pushedFor ?? null,
  contact: { name: o.name === undefined ? 'Sophie' : o.name, conversations: o.conv === null ? [] : [{ id: o.conv ?? 'c1' }] },
})

beforeEach(() => {
  mockReset(db)
  vi.mocked(sendPushToAll).mockClear()
  db.reminder.updateMany.mockResolvedValue({ count: 1 })
})

describe('buildReminderPayload (owner 2026-11-26: nama kontak + catatan)', () => {
  it('judul = nama kontak, isi = catatan; nomor HP dan email disaring; ketuk membuka chat kontak', () => {
    const p = buildReminderPayload({ id: 'r1', note: 'Telepon 0812 3456 7890 atau a@b.co soal jemput', contactName: 'Sophie', conversationId: 'c 1' })
    expect(p.title).toBe('Pengingat: Sophie')
    expect(p.body).not.toMatch(/0812|a@b\.co/)
    expect(p.body).toContain('soal jemput')
    expect(p).toMatchObject({ url: '/inbox?conversation=c%201', tag: 'reminder:r1' })
  })

  it('kontak tanpa nama/percakapan: judul umum, ketuk membuka Antrean', () => {
    expect(buildReminderPayload({ id: 'r2', note: 'x', contactName: null, conversationId: null })).toMatchObject({ title: 'Pengingat jatuh tempo', url: '/antrean' })
  })
})

describe('pushDueReminders', () => {
  it('mengirim sekali per jatuh tempo: yang sudah dikabarkan untuk dueAt itu dilewati, yang ditunda dikabarkan lagi', async () => {
    const due = new Date(NOW.getTime() - 60_000)
    db.reminder.findMany.mockResolvedValue([
      rem('baru', { dueAt: due }),
      rem('sudah', { dueAt: due, pushedFor: due }),
      rem('ditunda', { dueAt: due, pushedFor: new Date(due.getTime() - 86_400_000) }),
    ] as never)
    expect(await pushDueReminders(NOW)).toEqual({ sent: 2 })
    expect(vi.mocked(sendPushToAll).mock.calls.map(([p]) => p.tag)).toEqual(['reminder:baru', 'reminder:ditunda'])
    // klaim bersyarat pada nilai lama, lalu pushedFor = dueAt
    expect(db.reminder.updateMany).toHaveBeenCalledWith({ where: { id: 'baru', pushedFor: null, dueAt: due }, data: { pushedFor: due } })
  })

  it('hanya reminder belum selesai yang jatuh tempo dalam 24 jam terakhir yang dicari', async () => {
    db.reminder.findMany.mockResolvedValue([] as never)
    await pushDueReminders(NOW)
    expect(db.reminder.findMany.mock.calls[0][0]?.where).toEqual({ done: false, dueAt: { lte: NOW, gte: new Date(NOW.getTime() - MAX_LATE_MS) } })
  })

  it('klaim gagal (proses lain sudah mengirim) = tidak dikirim lagi', async () => {
    db.reminder.findMany.mockResolvedValue([rem('r1')] as never)
    db.reminder.updateMany.mockResolvedValue({ count: 0 })
    expect(await pushDueReminders(NOW)).toEqual({ sent: 0 })
    expect(sendPushToAll).not.toHaveBeenCalled()
  })

  it('tidak pernah melempar', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    db.reminder.findMany.mockRejectedValue(new Error('db mati'))
    await expect(pushDueReminders(NOW)).resolves.toEqual({ sent: 0 })
  })
})

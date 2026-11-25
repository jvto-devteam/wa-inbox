import { describe, expect, it } from 'vitest'
import { sampleQueue } from '@/components/new/__fixtures__/antrean'
import { ago, buildQueue } from './antrean'

const now = new Date('2026-11-25T06:00:00Z')

describe('antrean /new', () => {
  it('ago: menit, jam, hari', () => {
    expect(ago('2026-11-25T05:59:30Z', now)).toBe('baru saja')
    expect(ago('2026-11-25T05:30:00Z', now)).toBe('30 menit')
    expect(ago('2026-11-25T03:00:00Z', now)).toBe('3 jam')
    expect(ago('2026-11-22T06:00:00Z', now)).toBe('3 hari')
  })

  it('item per jenis ke tabnya; pengingat jatuh tempo ditandai; saran dari langkah berikut lalu rekomendasi lead', () => {
    const q = sampleQueue()
    q.items.open[0] = { ...q.items.open[0], anchorAt: '2026-11-25T03:00:00Z' }
    q.items.open[2] = { ...q.items.open[2], dueAt: '2026-11-25T05:00:00Z' }
    const Q = buildQueue(q.items, q.reminders, now)
    expect(Object.fromEntries(Object.entries(Q).map(([k, v]) => [k, v.map((x) => x.name)]))).toEqual({
      Balas: ['Sarah M.', 'Ben C.'], 'Tindak lanjut': ['Tom W.'], 'Janji tim': ['Rina K.'], Reminder: ['Mei H.', 'Hana Y.'],
    })
    expect(Q.Balas[0]).toMatchObject({ when: 'Menunggu 3 jam', saran: 'Konfirmasi jam jemput 05.00', href: '/inbox?conversation=c-a&message=m-a', itemId: 'a' })
    expect(Q['Tindak lanjut'][0]).toMatchObject({ when: 'Pengingat jatuh tempo', overdue: true })
    expect(Q.Reminder.find((x) => x.name === 'Hana Y.')).toMatchObject({ href: null, itemId: 'i9' })
  })

  it('tanpa data = semua tab kosong', () => {
    expect(Object.values(buildQueue(undefined, undefined, now)).every((v) => v.length === 0)).toBe(true)
  })
})

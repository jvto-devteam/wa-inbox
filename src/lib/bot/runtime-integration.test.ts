/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { loadPublishedManagedKnowledge } from '@/lib/bot/managed-knowledge'
import {
  shouldRunEscalationClassifier,
  fallbackReplyText,
  handoffReplyText,
  managedFactsFor,
  offHoursHandoffNotice,
} from './runtime-integration'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/bot/managed-knowledge', () => ({ loadPublishedManagedKnowledge: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

function entry(overrides: Record<string, unknown> = {}) {
  return {
    sourceId: 'ks_1',
    sourceKey: 'managed/atv',
    sourceTitle: 'FAQ Harga ATV',
    revisionId: 'krev_1',
    version: 2,
    items: [{ question: 'Berapa harga paket ATV?', answer: 'Mulai Rp350.000 per orang.' }],
    ...overrides,
  }
}

/** Pasang daftar item sebagai SATU entri managed terbit — di atas helper `entry()` yang sudah ada. */
function mockEntries(items: Array<Record<string, unknown>>) {
  vi.mocked(loadPublishedManagedKnowledge).mockResolvedValue({
    entries: [entry({ items })],
    available: true,
    loadedAt: 0,
  })
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.clearAllMocks()
  vi.mocked(loadPublishedManagedKnowledge).mockResolvedValue({ entries: [], available: true, loadedAt: 0 })
  mockPrisma.settings.findUnique.mockResolvedValue({
    fallbackReply: null,
    handoffReply: null,
    handoffOnHumanRequest: true,
  } as never)
})

describe('shouldRunEscalationClassifier', () => {
  it('runs the LLM escalation layer while the Settings switch is on', async () => {
    expect(await shouldRunEscalationClassifier()).toBe(true)
    expect(mockPrisma.settings.findUnique).toHaveBeenCalledWith({
      where: { id: 1 },
      select: { handoffOnHumanRequest: true },
    })
  })

  it('stops running it once an operator turns the switch off on /chatbot', async () => {
    mockPrisma.settings.findUnique.mockResolvedValue({ handoffOnHumanRequest: false } as never)
    expect(await shouldRunEscalationClassifier()).toBe(false)
  })

  it('keeps the classifier on when Settings cannot be read, without throwing', async () => {
    // Fail open, and open here means ON: this rule is a restriction on the bot, so an
    // unreadable switch has to leave the restriction in place rather than silently drop a
    // handoff path. A bot turn must never die because a CONFIGURATION lookup failed.
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockPrisma.settings.findUnique.mockRejectedValue(new Error('db down'))
    await expect(shouldRunEscalationClassifier()).resolves.toBe(true)
  })

  it('keeps the classifier on when the Settings row is missing entirely', async () => {
    // An un-seeded database is the same case as an unreadable one: no answer means the code's
    // own behaviour, never the opposite of it.
    mockPrisma.settings.findUnique.mockResolvedValue(null as never)
    await expect(shouldRunEscalationClassifier()).resolves.toBe(true)
  })
})

describe('fallbackReplyText', () => {
  it('returns the code default when the column is null', async () => {
    expect(await fallbackReplyText('kalimat bawaan')).toBe('kalimat bawaan')
  })

  it.each([
    ['an empty string', ''],
    ['whitespace only', '   \n '],
  ])('returns the code default when the operator cleared the box (%s)', async (_label, stored) => {
    // Clearing the box is how an operator REVERTS, not a request for the bot to say nothing.
    mockPrisma.settings.findUnique.mockResolvedValue({ fallbackReply: stored, handoffReply: null } as never)
    expect(await fallbackReplyText('kalimat bawaan')).toBe('kalimat bawaan')
  })

  it('returns the operator wording when the column holds one', async () => {
    mockPrisma.settings.findUnique.mockResolvedValue({ fallbackReply: 'Saya cek dulu ya.', handoffReply: null } as never)
    expect(await fallbackReplyText('kalimat bawaan')).toBe('Saya cek dulu ya.')
  })

  it('falls back to the code default when reading Settings throws, without throwing itself', async () => {
    // Fail open. A turn that dies because a CONFIGURATION lookup failed is far worse than one
    // running on the code's own wording.
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockPrisma.settings.findUnique.mockRejectedValue(new Error('db down'))
    await expect(fallbackReplyText('kalimat bawaan')).resolves.toBe('kalimat bawaan')
  })

  it('reads no row at all without throwing — an unseeded Settings still answers', async () => {
    mockPrisma.settings.findUnique.mockResolvedValue(null as never)
    expect(await fallbackReplyText('kalimat bawaan')).toBe('kalimat bawaan')
  })
})

describe('handoffReplyText', () => {
  it('returns the code default when the column is null', async () => {
    expect(await handoffReplyText('kalimat bawaan')).toBe('kalimat bawaan')
  })

  it('reads its own column, not the fallback one', async () => {
    mockPrisma.settings.findUnique.mockResolvedValue({
      fallbackReply: 'balasan tidak tahu',
      handoffReply: 'Tim kami segera membalas.',
    } as never)
    expect(await handoffReplyText('kalimat bawaan')).toBe('Tim kami segera membalas.')
  })

  it('falls back to the code default when reading Settings throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockPrisma.settings.findUnique.mockRejectedValue(new Error('db down'))
    await expect(handoffReplyText('kalimat bawaan')).resolves.toBe('kalimat bawaan')
  })
})

describe('managedFactsFor', () => {
  it('returns nothing when no managed knowledge is published', async () => {
    expect(await managedFactsFor('Berapa harga ATV?', null)).toEqual({ lines: [], refs: [] })
  })

  it('folds in an entry whose question shares a word with the message', async () => {
    vi.mocked(loadPublishedManagedKnowledge).mockResolvedValue({ entries: [entry()], available: true, loadedAt: 0 })

    const facts = await managedFactsFor('berapa harga paket ATV untuk 4 orang?', null)
    expect(facts.lines[0]).toContain('Mulai Rp350.000')
    expect(facts.refs).toEqual([
      { sourceType: 'MANAGED', sourceKey: 'managed/atv', title: 'FAQ Harga ATV', version: 2 },
    ])
  })

  it('leaves out an entry with nothing to do with the message', async () => {
    // Folding EVERY published entry into every prompt would bury the catalog facts the answer
    // actually needs, and hand the verifier prices the question never asked about.
    vi.mocked(loadPublishedManagedKnowledge).mockResolvedValue({ entries: [entry()], available: true, loadedAt: 0 })
    expect((await managedFactsFor('jam berapa pickup dari bandara?', null)).lines).toEqual([])
  })

  it('matches on tags as well as the question', async () => {
    vi.mocked(loadPublishedManagedKnowledge).mockResolvedValue({
      entries: [entry({ items: [{ question: 'Q', answer: 'A', tags: ['snorkeling'] }] })],
      available: true,
      loadedAt: 0,
    })
    expect((await managedFactsFor('ada paket snorkeling?', null)).lines).toHaveLength(1)
  })

  it('ignores short and common words, so everything does not match everything', async () => {
    vi.mocked(loadPublishedManagedKnowledge).mockResolvedValue({
      entries: [entry({ items: [{ question: 'apa yang bisa saya bawa?', answer: 'A' }] })],
      available: true,
      loadedAt: 0,
    })
    expect((await managedFactsFor('apa yang bisa saya lakukan di ijen?', null)).lines).toEqual([])
  })

  it('emits prices and links as their own lines, so the verifier can source them', async () => {
    // A figure buried in prose is indistinguishable, to the reply verifier, from one the model
    // invented — which is exactly what bot.no_invented_price protects against.
    vi.mocked(loadPublishedManagedKnowledge).mockResolvedValue({
      entries: [
        entry({
          items: [
            {
              question: 'Berapa harga ATV?',
              answer: 'Tergantung paket.',
              prices: [{ label: 'ATV 1 jam', amount: 350000, currency: 'IDR' }],
              links: [{ label: 'Detail', url: 'https://example.com/atv' }],
            },
          ],
        }),
      ],
      available: true,
      loadedAt: 0,
    })

    const facts = await managedFactsFor('berapa harga ATV?', null)
    expect(facts.lines.some((line) => line.includes('IDR 350000'))).toBe(true)
    expect(facts.lines.some((line) => line.includes('https://example.com/atv'))).toBe(true)
  })

  it('returns nothing rather than throwing when the loader fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(loadPublishedManagedKnowledge).mockRejectedValue(new Error('db down'))
    expect(await managedFactsFor('berapa harga ATV?', null)).toEqual({ lines: [], refs: [] })
  })

  it('returns nothing for a message with no usable words', async () => {
    vi.mocked(loadPublishedManagedKnowledge).mockResolvedValue({ entries: [entry()], available: true, loadedAt: 0 })
    expect((await managedFactsFor('ok!', null)).lines).toEqual([])
  })

  describe('gerbang topik', () => {
    it('menolak entri bertopik payment saat giliran bertopik route_endpoint', async () => {
      // Pertanyaan entri sengaja berbagi kata "surabaya" dengan pesan -- tanpa gerbang topik,
      // overlap token sendirian sudah cukup meloloskannya, jadi yang menolaknya di sini murni
      // gerbang topik, bukan kebetulan tidak ada kata yang cocok.
      mockEntries([
        { question: 'Berapa deposit di Surabaya?', answer: '20% dari total, dibayar di Surabaya.', topics: ['payment'] },
      ])
      const facts = await managedFactsFor('bisa drop off di surabaya?', 'route_endpoint')
      expect(facts.lines).toEqual([])
    })

    it('meloloskan entri yang memuat topik aktif', async () => {
      mockEntries([
        { question: 'Bisa selesai di Malang?', answer: 'Bisa.', topics: ['route_endpoint', 'price'] },
      ])
      const facts = await managedFactsFor('bisa selesai di malang?', 'route_endpoint')
      expect(facts.lines).toHaveLength(1)
    })

    it('entri tanpa topics berperilaku seperti sebelumnya — overlap token', async () => {
      mockEntries([{ question: 'Berapa harga ATV?', answer: 'Rp 300.000.' }])
      const facts = await managedFactsFor('berapa harga paket ATV?', 'route_endpoint')
      expect(facts.lines).toHaveLength(1)
    })

    // Ruling R30: giliran `general` tidak digerbang — entri bertopik tetap lolos lewat overlap kata.
    it('giliran bertopik general tidak digerbang', async () => {
      mockEntries([
        { question: 'Berapa deposit?', answer: '20% dari total, dibayar di Surabaya.', topics: ['payment'] },
      ])
      const facts = await managedFactsFor('deposit bisa dibayar di surabaya?', 'general')
      expect(facts.lines).toHaveLength(1)
    })
  })
})

/**
 * The off-hours handoff note.
 *
 * Every instant below is written as UTC on purpose. Asia/Jakarta is UTC+7 with no DST, so
 * 05:00Z is 12:00 WIB and 19:00Z is 02:00 WIB the next morning — and reading them as UTC
 * (which a server would) gives a DIFFERENT answer for several of these windows. That
 * difference is the point of the timezone test at the bottom of this block.
 */
describe('offHoursHandoffNotice', () => {
  /** Working hours configured, with whatever the test needs to vary. */
  function hours(overrides: Record<string, unknown> = {}) {
    mockPrisma.settings.findUnique.mockResolvedValue({
      workingHoursStart: '09:00',
      workingHoursEnd: '17:00',
      offHoursAutoReply: 'Tim kami membalas mulai pukul 09:00 WIB.',
      ...overrides,
    } as never)
  }

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // (a) The default case, and the one that must stay silent: a handoff at lunchtime already
  // reaches a human within minutes, so a note about when the team is back would be noise.
  it('(a) tidak menambahkan kalimat apa pun saat handoff terjadi di dalam jam kerja', async () => {
    hours()
    vi.setSystemTime(new Date('2026-09-08T05:00:00Z')) // 12:00 WIB
    expect(await offHoursHandoffNotice()).toBeNull()
  })

  it('(b) mengembalikan kalimat operator saat handoff terjadi di luar jam kerja', async () => {
    hours()
    vi.setSystemTime(new Date('2026-09-08T19:00:00Z')) // 02:00 WIB, jauh di luar 09:00-17:00
    expect(await offHoursHandoffNotice()).toBe('Tim kami membalas mulai pukul 09:00 WIB.')
  })

  // (c) Blank is how an operator turns this off -- the same convention as fallbackReply and
  // handoffReply above. There is no code default to fall back to here, because only the
  // operator knows when their own team is back.
  it('(c) tidak menambahkan apa pun saat offHoursAutoReply kosong atau NULL, walau di luar jam kerja', async () => {
    vi.setSystemTime(new Date('2026-09-08T19:00:00Z'))
    hours({ offHoursAutoReply: null })
    expect(await offHoursHandoffNotice()).toBeNull()
    hours({ offHoursAutoReply: '   ' })
    expect(await offHoursHandoffNotice()).toBeNull()
  })

  // (d) A half-filled form is the likeliest state of these two boxes, and it must mean "off",
  // never "outside working hours all day".
  it('(d) mematikan fitur saat salah satu batas jam NULL, kosong, atau bukan HH:MM', async () => {
    vi.setSystemTime(new Date('2026-09-08T19:00:00Z'))
    for (const broken of [
      { workingHoursStart: null },
      { workingHoursEnd: null },
      { workingHoursStart: '' },
      { workingHoursEnd: 'sore' },
      { workingHoursStart: '25:00' },
      { workingHoursEnd: '17:99' },
      // Zero-length window: far likelier a typo than a request to be closed 24 hours a day.
      { workingHoursStart: '09:00', workingHoursEnd: '09:00' },
    ]) {
      hours(broken)
      expect(await offHoursHandoffNotice()).toBeNull()
    }
  })

  // (e) A night shift is a real roster, and naive `start <= now < end` would call 02:00 "outside"
  // a 22:00-06:00 window -- exactly backwards.
  it('(e) menghitung jendela yang melewati tengah malam (22:00-06:00) dengan benar', async () => {
    hours({ workingHoursStart: '22:00', workingHoursEnd: '06:00' })

    vi.setSystemTime(new Date('2026-09-08T19:00:00Z')) // 02:00 WIB -- di dalam shift malam
    expect(await offHoursHandoffNotice()).toBeNull()

    vi.setSystemTime(new Date('2026-09-08T15:30:00Z')) // 22:30 WIB -- di dalam shift malam
    expect(await offHoursHandoffNotice()).toBeNull()

    vi.setSystemTime(new Date('2026-09-08T05:00:00Z')) // 12:00 WIB -- siang, di luar shift malam
    expect(await offHoursHandoffNotice()).toBe('Tim kami membalas mulai pukul 09:00 WIB.')

    vi.setSystemTime(new Date('2026-09-08T23:00:00Z')) // 06:00 WIB tepat -- batas akhir eksklusif
    expect(await offHoursHandoffNotice()).toBe('Tim kami membalas mulai pukul 09:00 WIB.')
  })

  // (f) Fail open, and open here means silent: the handoff itself must survive a database
  // hiccup, and the extra sentence is the part of it that is safe to lose.
  it('(f) tidak melempar saat pembacaan Settings gagal, cukup tidak menambahkan kalimat', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.setSystemTime(new Date('2026-09-08T19:00:00Z'))
    mockPrisma.settings.findUnique.mockRejectedValue(new Error('db down'))
    await expect(offHoursHandoffNotice()).resolves.toBeNull()

    // An unseeded Settings answers the same way, without throwing.
    mockPrisma.settings.findUnique.mockResolvedValue(null as never)
    await expect(offHoursHandoffNotice()).resolves.toBeNull()
  })

  /**
   * (g) The property that makes this feature trustworthy on a UTC VPS.
   *
   * 10:00Z is 17:00 WIB, which is OUTSIDE a 09:00-17:00 window (the end bound is exclusive) --
   * but reading the same instant on a UTC clock gives 10:00, squarely inside it. So a passing
   * assertion here can only mean the comparison was made in Asia/Jakarta. Running it under
   * several process timezones proves nothing about the host leaks in.
   */
  it('(g) menghitung jam terhadap Asia/Jakarta, bukan zona waktu server, apa pun TZ prosesnya', async () => {
    hours()
    vi.setSystemTime(new Date('2026-09-08T10:00:00Z')) // 17:00 WIB / 10:00 UTC / 06:00 New York

    const originalTz = process.env.TZ
    try {
      for (const tz of ['UTC', 'America/New_York', 'Asia/Jakarta', 'Pacific/Auckland']) {
        process.env.TZ = tz
        expect(await offHoursHandoffNotice()).toBe('Tim kami membalas mulai pukul 09:00 WIB.')
      }

      // And the mirror image, so the assertion above is not just "always outside": 05:00Z is
      // 12:00 WIB, inside the window, whatever the process thinks the time is.
      vi.setSystemTime(new Date('2026-09-08T05:00:00Z'))
      for (const tz of ['UTC', 'America/New_York', 'Pacific/Auckland']) {
        process.env.TZ = tz
        expect(await offHoursHandoffNotice()).toBeNull()
      }
    } finally {
      if (originalTz === undefined) delete process.env.TZ
      else process.env.TZ = originalTz
    }
  })
})

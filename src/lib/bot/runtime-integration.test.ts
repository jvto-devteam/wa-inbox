/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { loadPublishedManagedKnowledge } from '@/lib/bot/managed-knowledge'
import { FAQ_SEED_DATA } from '@/lib/bot-control/faq-seed-data'
import {
  shouldRunEscalationClassifier,
  fallbackReplyText,
  handoffReplyText,
  managedFactsFor,
  allManagedFacts,
  offHoursHandoffNotice,
  MAX_MANAGED_ITEMS_PER_TURN,
  MAX_REJECTED_RECORDED,
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
    // Ruling R25: gateBypassed sekarang bagian dari ManagedFacts -- EMPTY membawanya juga.
    // Ruling R63: truncated juga bagian dari ManagedFacts -- EMPTY membawanya juga (0).
    // Ruling R46: degraded juga bagian dari ManagedFacts -- `available: true` (default beforeEach)
    // dengan nol entri terbit memang berarti "tidak ada knowledge", bukan kerusakan, jadi false.
    // Task 17: rejected juga bagian dari ManagedFacts -- EMPTY membawanya juga ([]).
    // Ruling R83: rejectedOmitted juga bagian dari ManagedFacts -- EMPTY membawanya juga (0).
    expect(await managedFactsFor('Berapa harga ATV?', null)).toEqual({ lines: [], refs: [], gateBypassed: false, truncated: 0, rejected: [], rejectedOmitted: 0, degraded: false })
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

  // Fix round 1 (R79, reviewer Minor b): `lineSources` (feeds DecisionKnowledge.managedLines'
  // per-line `source` in orchestrator.ts) must stay aligned 1:1 with `lines` -- the question
  // line, its price line, and its link line all came from the SAME item, so all three must
  // carry the SAME source string.
  it('lineSources sejajar 1:1 dengan lines untuk item yang punya harga dan tautan', async () => {
    vi.mocked(loadPublishedManagedKnowledge).mockResolvedValue({
      entries: [
        entry({
          sourceTitle: 'FAQ Harga ATV',
          version: 2,
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

    expect(facts.lines).toHaveLength(3)
    expect(facts.lines[0]).toContain('Berapa harga ATV?')
    expect(facts.lines[1]).toContain('IDR 350000')
    expect(facts.lines[2]).toContain('https://example.com/atv')
    expect(facts.lineSources).toEqual(['FAQ Harga ATV (v2)', 'FAQ Harga ATV (v2)', 'FAQ Harga ATV (v2)'])
  })

  it('returns nothing rather than throwing when the loader fails -- but flags it as degraded, not silence', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(loadPublishedManagedKnowledge).mockRejectedValue(new Error('db down'))
    // Ruling R25: gateBypassed sekarang bagian dari ManagedFacts -- EMPTY membawanya juga.
    // Ruling R63: truncated juga bagian dari ManagedFacts -- EMPTY membawanya juga (0).
    // Ruling R46: BERBEDA dari test "tidak ada knowledge terbit" di atas -- di sini loader-nya
    // sendiri gagal (melempar), jadi `degraded` harus TRUE, bukan false: kegagalan pembacaan
    // wajib bisa dibedakan dari "memang tidak ada knowledge" oleh pemanggil (orchestrator.ts).
    // Task 17: rejected juga bagian dari ManagedFacts -- EMPTY membawanya juga ([]).
    // Ruling R83: rejectedOmitted juga bagian dari ManagedFacts -- EMPTY membawanya juga (0).
    expect(await managedFactsFor('berapa harga ATV?', null)).toEqual({ lines: [], refs: [], gateBypassed: false, truncated: 0, rejected: [], rejectedOmitted: 0, degraded: true })
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
      //
      // Ruling R41: `true` dikirim sebagai hasCatalogFacts -- route_endpoint memang dijawab
      // katalog di giliran nyata, jadi jaring (retry tanpa gerbang) TIDAK boleh menyala di sini.
      // Tanpa `true`, test ini masih lolos tapi diam-diam berubah jadi kasus bypass (baris balik
      // lewat jaring), bukan lagi bukti penolakan gerbang.
      mockEntries([
        { question: 'Berapa deposit di Surabaya?', answer: '20% dari total, dibayar di Surabaya.', topics: ['payment'] },
      ])
      const facts = await managedFactsFor('bisa drop off di surabaya?', 'route_endpoint', true)
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

  // Task 22 (Ruling R101): sebuah pesan bisa menanyakan lebih dari satu topik sekaligus
  // (classifyAllTopics, panggilan LLM terpisah dari classifyTopicViaLLM -- lihat
  // multi-topic-classifier.ts). `alsoTopics` meloloskan entri Lapis 1 yang topiknya cocok
  // dengan SALAH SATU dari topik itu, bukan hanya topik UTAMA -- sama seperti
  // `item.topics.includes(topic)` sekarang jadi `item.topics.includes(topic) ||
  // alsoTopics.some(...)`. `general`/`null` (R30/R41) tidak terpengaruh -- `alsoTopics` hanya
  // dibaca di Lapis 1 (gerbang topik spesifik), yang tidak pernah berjalan untuk keduanya.
  describe('topik tambahan (alsoTopics, Ruling R101)', () => {
    it('meloloskan entri yang bertopik salah satu alsoTopics, walau bukan topik utama', async () => {
      mockEntries([
        { question: 'Bisa selesai di Malang?', answer: 'Bisa.', topics: ['route_endpoint'] },
      ])
      const facts = await managedFactsFor('berapa deposit dan bisa drop off di malang?', 'payment', false, ['route_endpoint'])
      expect(facts.lines).toHaveLength(1)
      expect(facts.gateBypassed).toBe(false)
    })

    it('tetap menolak entri yang bukan topik utama maupun salah satu alsoTopics', async () => {
      mockEntries([
        { question: 'Termasuk apa saja di paket?', answer: 'Semua sudah termasuk.', topics: ['inclusions'] },
      ])
      const facts = await managedFactsFor(
        'berapa deposit dan bisa drop off di malang?',
        'payment',
        true, // hasCatalogFacts=true supaya jaring R41 tidak menyala dan menyembunyikan penolakan gerbang
        ['route_endpoint']
      )
      expect(facts.lines).toEqual([])
    })

    it('item yang masuk lewat also-topic dihitung admittedByTopic untuk plafon R63 -- mengalahkan item overlap saat plafon penuh', async () => {
      // 8 item bertopik route_endpoint (also-topic giliran ini, bukan topik utama) mengisi
      // plafon penuh -- item overlap murni (tanpa `topics`) harus kalah persis seperti kalau
      // ke-8 item itu masuk lewat topik UTAMA (test R63 yang setara di atas).
      const alsoItems = Array.from({ length: MAX_MANAGED_ITEMS_PER_TURN }, (_, i) => ({
        question: `Also cocok nomor ${i}?`,
        answer: `Also jawaban ${i}.`,
        topics: ['route_endpoint'],
      }))
      const overlapItem = { question: 'Berapa harga tiket masuk kawah ijen?', answer: 'Overlap jawaban.' }
      mockEntries([...alsoItems, overlapItem])

      const facts = await managedFactsFor('berapa harga tiket masuk kawah ijen?', 'price', false, ['route_endpoint'])

      expect(facts.truncated).toBe(1)
      expect(facts.lines).toHaveLength(MAX_MANAGED_ITEMS_PER_TURN)
      expect(facts.lines.every((line) => line.startsWith('Also cocok'))).toBe(true)
      expect(facts.lines.some((line) => line.includes('Overlap jawaban.'))).toBe(false)
    })

    it('entri yang cocok topik UTAMA tetap lolos walau alsoTopics tidak menyebutnya (tanpa regresi)', async () => {
      mockEntries([
        { question: 'Berapa deposit?', answer: '20%.', topics: ['payment'] },
      ])
      const facts = await managedFactsFor('berapa deposit dan bisa drop off di malang?', 'payment', false, ['route_endpoint'])
      expect(facts.lines.some((line) => line.includes('20%.'))).toBe(true)
    })

    it('giliran general tetap tidak digerbang berdasar topik walau alsoTopics diisi (R30 tidak berubah)', async () => {
      mockEntries([
        { question: 'Berapa deposit?', answer: '20% dari total, dibayar di Surabaya.', topics: ['payment'] },
      ])
      const facts = await managedFactsFor('deposit bisa dibayar di surabaya?', 'general', false, ['route_endpoint'])
      expect(facts.lines).toHaveLength(1)
    })

    it('jaring R41 (topic: null) tidak terpengaruh alsoTopics -- Lapis 1 tidak pernah berjalan di sana', async () => {
      mockEntries([
        { question: 'Bisa selesai di Malang?', answer: 'Bisa.', topics: ['inclusions'] },
      ])
      // Topik utama 'price' tidak cocok dan alsoTopics juga tidak menyebut 'inclusions' --
      // gerbang menolak semuanya, lalu jaring menyala (hasCatalogFacts=false default). Entri ini
      // MASUK lewat jaring justru KARENA ada overlap kata: pesan dan pertanyaan entri berbagi dua
      // token bermakna, "selesai" dan "malang" ("bisa" stopword, "di" di bawah 4 huruf). Jaring
      // bergantung pada overlap itu, bukan pada alsoTopics.
      const facts = await managedFactsFor('bisa selesai di malang?', 'price', false, ['route_endpoint'])
      expect(facts.gateBypassed).toBe(true)
      expect(facts.lines).toHaveLength(1)
    })
  })

  // Task 17 (Ruling R54): "ditolak" hanya memuat entri yang ditolak gerbang TETAPI lolos
  // overlap kata (akan masuk kalau gerbang tidak ada) -- bukan entri tanpa satu kata pun yang
  // sama, dan bukan entri yang kemudian dimasukkan kembali oleh jaring R41.
  describe('rejected (Ruling R54)', () => {
    it('mencatat entri yang ditolak gerbang beserta alasannya', async () => {
      mockEntries([
        { question: 'Berapa deposit di Malang?', answer: '20%.', topics: ['payment'] },
      ])
      // Berbagi kata "malang" dengan pesan: tanpa gerbang entri ini akan ikut. `true` = katalog
      // punya fakta (R41), jadi jaring tidak memasukkannya kembali.
      const facts = await managedFactsFor('bisa selesai di malang?', 'route_endpoint', true)
      expect(facts.rejected).toEqual([
        expect.objectContaining({
          sourceKey: 'managed/atv',
          itemQuestion: 'Berapa deposit di Malang?',
          reason: 'topik [payment] tidak memuat route_endpoint',
        }),
      ])
    })

    it('entri yang ditolak gerbang TANPA satu kata pun yang sama TIDAK dicatat', async () => {
      mockEntries([
        { question: 'Berapa deposit upfront?', answer: '20%.', topics: ['payment'] },
      ])
      // Tidak berbagi kata bermakna apa pun dengan pesan -- entri ini tidak akan masuk dengan
      // atau tanpa gerbang, jadi gerbang bukan alasannya.
      const facts = await managedFactsFor('bisa antar jemput dari bandara?', 'route_endpoint', true)
      expect(facts.rejected).toEqual([])
    })

    it('entri yang dimasukkan kembali oleh jaring R41 TIDAK dicatat sebagai ditolak', async () => {
      mockEntries([
        { question: 'Berapa deposit di Malang?', answer: '20%.', topics: ['payment'] },
      ])
      // hasCatalogFacts=false -- katalog belum menjawab apa pun, jadi jaring menyala dan
      // memasukkan kembali entri ini lewat overlap kata ("malang").
      const facts = await managedFactsFor('bisa selesai di malang?', 'route_endpoint', false)
      expect(facts.gateBypassed).toBe(true)
      expect(facts.lines).toHaveLength(1)
      expect(facts.rejected).toEqual([])
    })

    // Fix round 1 (R79, reviewer Minor a): giliran `general` dan giliran `null` TIDAK
    // digerbang berdasar topik sama sekali (Ruling R30/R41) -- `specificTopic` di
    // `evaluateItem` adalah false untuk keduanya, jadi Lapis 1 (satu-satunya tempat
    // `gateRejectedWithOverlap` bisa bernilai true) tidak pernah berjalan. Item bertopik tidak
    // cocok tetap MASUK lewat overlap kata (Lapis 2) -- bukan "ditolak lalu dimasukkan
    // kembali" seperti jaring R41, ia tidak pernah ditolak sama sekali.
    it('giliran general: item topik tidak cocok tapi overlap kata -> masuk, rejected tetap kosong', async () => {
      mockEntries([
        { question: 'Berapa deposit di Surabaya?', answer: '20% dari total.', topics: ['payment'] },
      ])
      const facts = await managedFactsFor('deposit bisa dibayar di surabaya?', 'general')
      expect(facts.lines).toHaveLength(1)
      expect(facts.rejected).toEqual([])
    })

    it('giliran null: item topik tidak cocok tapi overlap kata -> masuk, rejected tetap kosong', async () => {
      mockEntries([
        { question: 'Bisa selesai di Malang?', answer: 'Bisa.', topics: ['payment'] },
      ])
      const facts = await managedFactsFor('bisa selesai di malang?', null)
      expect(facts.lines).toHaveLength(1)
      expect(facts.rejected).toEqual([])
    })
  })

  // Ruling R82: dokumentasi test -- BUKAN test untuk kode baru. Membuktikan bahwa item yang
  // dipotong plafon DI JALUR JARING (retry tanpa gerbang, Ruling R41) terhitung di `truncated`,
  // bukan di `rejected` -- `rejected` dikosongkan begitu jaring menghasilkan sesuatu, terlepas
  // dari berapa banyak kandidatnya yang kalah kena plafon. Ini sudah perilaku kode sebelum
  // ruling ini; ruling ini hanya memperbaiki KOMENTAR yang salah menyatakan "item yang ditolak
  // gerbang SUDAH pasti ikut dimasukkan kembali oleh jaring" -- salah kalau kandidat jaring
  // melebihi MAX_MANAGED_ITEMS_PER_TURN. Test ini lulus TANPA perubahan kode apa pun.
  it('R82: item yang terpotong plafon di jalur jaring terhitung di truncated, bukan rejected', async () => {
    // 10 item bertopik payment, semuanya berbagi kata "harga" dengan pesan bertopik price --
    // gerbang menolak semuanya (topik tidak cocok), tapi overlap kata > 0 untuk semuanya jadi
    // ke-10-nya masuk `gated.rejected`. hasCatalogFacts default (false) supaya jaring menyala.
    const items = Array.from({ length: 10 }, (_, i) => ({
      question: `Berapa harga tambahan skenario ${i}?`,
      answer: `Jawaban ${i}.`,
      topics: ['payment'],
    }))
    mockEntries(items)

    const facts = await managedFactsFor('berapa harga tambahan untuk skenario saya?', 'price')

    expect(facts.gateBypassed).toBe(true)
    expect(facts.lines).toHaveLength(MAX_MANAGED_ITEMS_PER_TURN)
    expect(facts.truncated).toBe(2)
    expect(facts.rejected).toEqual([])
  })

  // Ruling R83: `rejected` sekarang dibatasi MAX_REJECTED_RECORDED (20) entri per giliran --
  // sebelumnya sebuah giliran nyata mencatat 150 dari 150 entri topik-lain beririsan kata
  // sekaligus, disimpan tiga kali per giliran (BotDecisionRun.trace/knowledgeRefs,
  // Message.botTrace) tanpa retensi apa pun.
  describe('plafon rejected (Ruling R83)', () => {
    it('mencatat maksimum MAX_REJECTED_RECORDED (20) entri yang ditolak gerbang, sisanya dihitung di rejectedOmitted', async () => {
      const items = Array.from({ length: 150 }, (_, i) => ({
        question: `Bisa selesai di Malang nomor ${i}?`,
        answer: `Jawaban ${i}.`,
        topics: ['payment'],
      }))
      mockEntries(items)

      // hasCatalogFacts=true supaya jaring R41 TIDAK menyala -- kalau menyala, `rejected`
      // dikosongkan sepenuhnya (Ruling R41/R54) dan test ini tidak lagi menguji plafon R83.
      const facts = await managedFactsFor('bisa selesai di malang?', 'route_endpoint', true)

      expect(facts.rejected).toHaveLength(MAX_REJECTED_RECORDED)
      expect(facts.rejectedOmitted).toBe(150 - MAX_REJECTED_RECORDED)
      // Urutan asli dipertahankan -- 20 pertama, bukan 20 acak/terakhir.
      expect(facts.rejected.map((r) => r.itemQuestion)).toEqual(
        Array.from({ length: MAX_REJECTED_RECORDED }, (_, i) => `Bisa selesai di Malang nomor ${i}?`)
      )
    })

    it('rejectedOmitted tetap 0 saat jumlah entri yang ditolak di bawah plafon', async () => {
      mockEntries([{ question: 'Berapa deposit di Malang?', answer: '20%.', topics: ['payment'] }])
      const facts = await managedFactsFor('bisa selesai di malang?', 'route_endpoint', true)
      expect(facts.rejected).toHaveLength(1)
      expect(facts.rejectedOmitted).toBe(0)
    })

    it('jaring R41 yang menyala mengosongkan rejected DAN rejectedOmitted bersamaan', async () => {
      // hasCatalogFacts=false -- jaring menyala, memasukkan kembali entri lewat overlap kata,
      // dan (Ruling R54/R82) mengosongkan `rejected`. rejectedOmitted harus ikut kosong: tidak
      // ada yang "dibuang dari daftar" kalau daftarnya sendiri sudah dikosongkan.
      const items = Array.from({ length: 25 }, (_, i) => ({
        question: `Bisa selesai di Malang nomor ${i}?`,
        answer: `Jawaban ${i}.`,
        topics: ['payment'],
      }))
      mockEntries(items)

      const facts = await managedFactsFor('bisa selesai di malang?', 'route_endpoint', false)

      expect(facts.gateBypassed).toBe(true)
      expect(facts.rejected).toEqual([])
      expect(facts.rejectedOmitted).toBe(0)
    })
  })

  describe('jaring saat gerbang menghasilkan nol (Ruling R41)', () => {
    it('mengulang tanpa gerbang saat gerbang menghasilkan nol, dan menandainya', async () => {
      mockEntries([
        { question: 'Bisa selesai di Malang?', answer: 'Bisa.', topics: ['route_endpoint'] },
      ])
      const facts = await managedFactsFor('bisa selesai di malang?', 'price')
      expect(facts.lines).toHaveLength(1)
      expect(facts.gateBypassed).toBe(true)
    })

    it('tidak menandai bypass saat gerbang memang menghasilkan baris', async () => {
      mockEntries([
        { question: 'Bisa selesai di Malang?', answer: 'Bisa.', topics: ['route_endpoint'] },
      ])
      const facts = await managedFactsFor('bisa selesai di malang?', 'route_endpoint')
      expect(facts.gateBypassed).toBe(false)
    })

    // Ruling R41: kalau katalog SUDAH punya fakta untuk giliran ini, jaring tidak boleh
    // menyala -- fixture sama dengan test bypass di atas, bedanya hanya hasCatalogFacts=true.
    it('tidak mengulang tanpa gerbang saat katalog sudah punya fakta untuk giliran ini', async () => {
      mockEntries([
        { question: 'Bisa selesai di Malang?', answer: 'Bisa.', topics: ['route_endpoint'] },
      ])
      const facts = await managedFactsFor('bisa selesai di malang?', 'price', true)
      expect(facts.lines).toEqual([])
      expect(facts.gateBypassed).toBe(false)
    })

    // Ruling R47: melengkapi cabang `ungated.lines.length > 0` -> false (runtime-integration.ts,
    // baris terakhir managedFactsFor) -- gerbang menolak entri (topik tak cocok) DAN jaring
    // (retry tanpa gerbang) pun tidak menemukan overlap kata apa pun dengan pesan, jadi
    // keduanya sama-sama nol dan hasilnya TIDAK ditandai bypass.
    it('tidak menandai bypass saat gerbang DAN jaring sama-sama tidak menemukan apa-apa', async () => {
      mockEntries([
        { question: 'Bisa selesai di Malang?', answer: 'Bisa.', topics: ['route_endpoint'] },
      ])
      const facts = await managedFactsFor('apakah ada diskon musim hujan?', 'price')
      expect(facts.lines).toEqual([])
      expect(facts.gateBypassed).toBe(false)
    })
  })

  // Ruling R56: topik yang cocok sudah CUKUP untuk masuk -- overlap kata bukan lagi syarat
  // masuk untuk setiap entri, hanya alat untuk entri yang topiknya tidak bisa memutuskan.
  describe('topik cocok cukup untuk masuk (Ruling R56)', () => {
    it('topik spesifik yang cocok meloloskan entri walau tak ada satu kata pun yang sama dengan pesan', async () => {
      // "upfront" tidak berbagi kata apa pun dengan "Berapa deposit?" -- persis parafrasa yang
      // tujuan gerbang topik ingin tangani.
      mockEntries([
        { question: 'Berapa deposit?', answer: '20% dari total.', topics: ['payment'] },
      ])
      const facts = await managedFactsFor('how much do I pay upfront?', 'payment')
      expect(facts.lines).toHaveLength(1)
    })

    it('giliran general + item bertopik general tanpa kata yang sama dengan pesan → masuk', async () => {
      mockEntries([
        { question: 'Kami buka setiap hari?', answer: 'Ya, kami buka setiap hari termasuk libur.', topics: ['general'] },
      ])
      const facts = await managedFactsFor('apakah kalian punya diskon musim hujan?', 'general')
      expect(facts.lines).toHaveLength(1)
    })

    it('giliran general + item bertopik payment (bukan general) tanpa kata yang sama → TIDAK masuk', async () => {
      mockEntries([
        { question: 'Berapa deposit?', answer: '20% dari total.', topics: ['payment'] },
      ])
      const facts = await managedFactsFor('apakah kalian punya diskon musim hujan?', 'general')
      expect(facts.lines).toEqual([])
    })

    it('pesan hanya berisi stopword tetap meloloskan entri lewat topik spesifik yang cocok', async () => {
      // Sebelum perbaikan ini, `managedFactsFor` keluar lebih dulu saat `asked.size === 0` --
      // entri yang topiknya cocok pun tidak pernah dipertimbangkan.
      mockEntries([
        { question: 'Deposit dibayar di mana?', answer: 'Di Surabaya.', topics: ['payment'] },
      ])
      const facts = await managedFactsFor('berapa?', 'payment')
      expect(facts.lines).toHaveLength(1)
    })

    it('topik null dengan pesan yang hanya berisi stopword tetap kosong', async () => {
      // Jaring R41 (dan pemanggil tanpa topik) hanya punya overlap kata sebagai dasar -- tanpa
      // kata bermakna sama sekali, tidak ada dasar apa pun untuk meloloskan entri.
      mockEntries([
        { question: 'Deposit dibayar di mana?', answer: 'Di Surabaya.', topics: ['payment'] },
      ])
      const facts = await managedFactsFor('berapa?', null)
      expect(facts.lines).toEqual([])
    })
  })

  // Ruling R63 (Task 5c): plafon item knowledge terkelola per giliran. `MAX_MANAGED_ITEMS_PER_TURN`
  // dihitung dalam ITEM, bukan baris.
  describe('plafon item per giliran (Ruling R63)', () => {
    it('memangkas ke plafon saat lebih dari MAX_MANAGED_ITEMS_PER_TURN item bertopik cocok, dan menghitung truncated', async () => {
      const items = Array.from({ length: 10 }, (_, i) => ({
        question: `Pertanyaan khusus nomor ${i}?`,
        answer: `Jawaban ${i}.`,
        topics: ['route_endpoint'],
      }))
      mockEntries(items)

      // Pesan sengaja tidak berbagi kata apa pun dengan pertanyaan item -- semua 10 item lolos
      // murni lewat topik (Lapis 1), jadi semuanya seri pada admittedByTopic dan overlapScore;
      // urutan asli (item 0..7) yang memutus seri.
      const facts = await managedFactsFor('bisa drop off di kota lain?', 'route_endpoint')

      expect(facts.lines).toHaveLength(MAX_MANAGED_ITEMS_PER_TURN)
      expect(facts.truncated).toBe(2)
      for (let i = 0; i < 8; i++) expect(facts.lines.some((line) => line.includes(`Jawaban ${i}.`))).toBe(true)
      expect(facts.lines.some((line) => line.includes('Jawaban 8.'))).toBe(false)
      expect(facts.lines.some((line) => line.includes('Jawaban 9.'))).toBe(false)
    })

    it('item yang masuk lewat topik mengalahkan item yang masuk lewat overlap kata saat plafon penuh', async () => {
      const topicItems = Array.from({ length: 8 }, (_, i) => ({
        question: `Topik cocok nomor ${i}?`,
        answer: `Topik jawaban ${i}.`,
        topics: ['price'],
      }))
      // Tidak punya `topics`, jadi hanya bisa masuk lewat overlap kata (Lapis 2) -- dan overlap-
      // nya sengaja dibuat SANGAT tinggi (identik dengan pesan) supaya kegagalannya masuk plafon
      // murni karena kalah kelompok (overlap, bukan topik), bukan karena skornya rendah.
      const overlapItem = { question: 'Berapa harga tiket masuk kawah ijen?', answer: 'Overlap jawaban.' }
      mockEntries([...topicItems, overlapItem])

      const facts = await managedFactsFor('berapa harga tiket masuk kawah ijen?', 'price')

      expect(facts.truncated).toBe(1)
      expect(facts.lines).toHaveLength(8)
      expect(facts.lines.every((line) => line.startsWith('Topik cocok'))).toBe(true)
      expect(facts.lines.some((line) => line.includes('Overlap jawaban.'))).toBe(false)
    })

    it('di antara item yang masuk lewat overlap, skor overlap lebih tinggi menang; seri diputus oleh urutan asli', async () => {
      // Pesan hanya berisi 4 kata bermakna -- skor overlap tiap item di bawah dihitung dari
      // berapa banyak kata itu yang muncul di pertanyaan/tag item.
      mockEntries([
        { question: 'abcd efgh ijkl mnop', answer: 'A0' }, // skor 4
        { question: 'abcd efgh ijkl mnop', answer: 'A1' }, // skor 4 (seri dengan A0)
        { question: 'abcd efgh ijkl', answer: 'A2' }, // skor 3
        { question: 'abcd efgh ijkl', answer: 'A3' }, // skor 3 (seri dengan A2)
        { question: 'abcd efgh', answer: 'A4' }, // skor 2
        { question: 'abcd efgh', answer: 'A5' }, // skor 2 (seri dengan A4)
        { question: 'abcd', answer: 'A6' }, // skor 1
        { question: 'abcd', answer: 'A7' }, // skor 1 (seri dengan A6)
        { question: 'abcd', answer: 'A8' }, // skor 1 (seri dengan A6/A7 -- urutan asli kalah)
      ])

      const facts = await managedFactsFor('abcd efgh ijkl mnop', null)

      expect(facts.truncated).toBe(1)
      for (const label of ['A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7']) {
        expect(facts.lines.some((line) => line.includes(`— ${label}`))).toBe(true)
      }
      // A8 seri skor (1) dengan A6/A7, tapi datang belakangan di urutan asli -- kalah saat
      // plafon sudah penuh.
      expect(facts.lines.some((line) => line.includes('— A8'))).toBe(false)
    })

    it('mengeluarkan item terpilih dalam urutan ASLI entri/item, bukan urutan peringkat', async () => {
      mockEntries([
        { question: 'abcd', answer: 'Skor rendah, urutan asli pertama' }, // skor 1
        { question: 'abcd efgh ijkl', answer: 'Skor tinggi, urutan asli kedua' }, // skor 3
        { question: 'abcd efgh', answer: 'Skor sedang, urutan asli ketiga' }, // skor 2
      ])

      const facts = await managedFactsFor('abcd efgh ijkl', null)

      // Ketiganya lolos (di bawah plafon), jadi urutan keluaran murni menguji tie-break/urutan
      // emisi: harus urutan ASLI (index 0, 1, 2), BUKAN urutan peringkat (yang akan menaruh
      // item skor 3 lebih dulu).
      expect(facts.truncated).toBe(0)
      expect(facts.lines).toEqual([
        'abcd — Skor rendah, urutan asli pertama',
        'abcd efgh ijkl — Skor tinggi, urutan asli kedua',
        'abcd efgh — Skor sedang, urutan asli ketiga',
      ])
    })

    it('truncated tetap 0 di bawah plafon, dan hasilnya sama seperti perilaku sebelum task ini', async () => {
      vi.mocked(loadPublishedManagedKnowledge).mockResolvedValue({ entries: [entry()], available: true, loadedAt: 0 })

      const facts = await managedFactsFor('berapa harga paket ATV untuk 4 orang?', null)

      expect(facts.truncated).toBe(0)
      expect(facts.lines[0]).toContain('Mulai Rp350.000')
      expect(facts.refs).toEqual([
        { sourceType: 'MANAGED', sourceKey: 'managed/atv', title: 'FAQ Harga ATV', version: 2 },
      ])
    })

    // Ruling R73 (review fix round 1): setiap test R63 di atas memakai `mockEntries`, yang
    // memaksa semua item ke SATU entri -- cabang komparator `entryIndex` di `collect` (dipakai
    // saat dua item dari entri BERBEDA seri pada admittedByTopic dan overlapScore) tidak pernah
    // teruji. Dua entri terpisah lewat `entry()`/`loadPublishedManagedKnowledge` langsung di
    // sini, bukan `mockEntries`.
    it('seri lintas BEBERAPA entri diputus oleh urutan entri, bukan hanya urutan item', async () => {
      const entryA = entry({
        sourceId: 'ks_a',
        sourceKey: 'managed/a',
        sourceTitle: 'FAQ Entri A',
        revisionId: 'krev_a',
        version: 1,
        items: Array.from({ length: 5 }, (_, i) => ({
          question: `Entry A pertanyaan nomor ${i}?`,
          answer: `JawabanA${i}`,
          topics: ['route_endpoint'],
        })),
      })
      const entryB = entry({
        sourceId: 'ks_b',
        sourceKey: 'managed/b',
        sourceTitle: 'FAQ Entri B',
        revisionId: 'krev_b',
        version: 1,
        items: Array.from({ length: 5 }, (_, i) => ({
          question: `Entry B pertanyaan nomor ${i}?`,
          answer: `JawabanB${i}`,
          topics: ['route_endpoint'],
        })),
      })
      vi.mocked(loadPublishedManagedKnowledge).mockResolvedValue({
        entries: [entryA, entryB],
        available: true,
        loadedAt: 0,
      })

      // Pesan tidak berbagi kata apa pun dengan pertanyaan item manapun -- semua 10 item lolos
      // murni lewat topik (admittedByTopic=true, overlapScore=0 untuk semuanya), jadi SATU-
      // satunya yang bisa memutus seri adalah urutan entri lalu urutan item.
      const facts = await managedFactsFor('bisa drop off di kota lain?', 'route_endpoint')

      expect(facts.truncated).toBe(2)
      // Entri A (entryIndex 0) menang penuh -- kelima itemnya masuk -- sebelum entri B
      // (entryIndex 1) sempat menyumbang satu pun, persis seperti urutan asli entri/item.
      expect(facts.lines).toEqual([
        'Entry A pertanyaan nomor 0? — JawabanA0',
        'Entry A pertanyaan nomor 1? — JawabanA1',
        'Entry A pertanyaan nomor 2? — JawabanA2',
        'Entry A pertanyaan nomor 3? — JawabanA3',
        'Entry A pertanyaan nomor 4? — JawabanA4',
        'Entry B pertanyaan nomor 0? — JawabanB0',
        'Entry B pertanyaan nomor 1? — JawabanB1',
        'Entry B pertanyaan nomor 2? — JawabanB2',
      ])
      expect(facts.refs.map((r) => r.sourceKey)).toEqual(['managed/a', 'managed/b'])
    })

    // Ruling R73 (review fix round 1): `refs` harus MENGECUALIKAN sebuah entri kalau plafon
    // memotong habis semua itemnya -- entri lain yang sebagian/seluruh itemnya selamat tetap
    // tercantum. Ini menguji baris skip-kosong di `collect` (`if (!itemIndices ||
    // itemIndices.size === 0) return`), bukan cuma isi `lines`.
    it('refs mengecualikan entri yang seluruh itemnya terpangkas plafon, sementara entri lain tetap tercantum', async () => {
      const entryX = entry({
        sourceId: 'ks_x',
        sourceKey: 'managed/x',
        sourceTitle: 'FAQ Entri X',
        revisionId: 'krev_x',
        version: 1,
        // Persis mengisi plafon sendirian -- tidak menyisakan satu slot pun untuk entri Y.
        items: Array.from({ length: MAX_MANAGED_ITEMS_PER_TURN }, (_, i) => ({
          question: `Entry X pertanyaan nomor ${i}?`,
          answer: `JawabanX${i}`,
          topics: ['price'],
        })),
      })
      const entryY = entry({
        sourceId: 'ks_y',
        sourceKey: 'managed/y',
        sourceTitle: 'FAQ Entri Y',
        revisionId: 'krev_y',
        version: 1,
        items: Array.from({ length: 3 }, (_, i) => ({
          question: `Entry Y pertanyaan nomor ${i}?`,
          answer: `JawabanY${i}`,
          topics: ['price'],
        })),
      })
      vi.mocked(loadPublishedManagedKnowledge).mockResolvedValue({
        entries: [entryX, entryY],
        available: true,
        loadedAt: 0,
      })

      const facts = await managedFactsFor('oke, saya mengerti sekarang', 'price')

      expect(facts.truncated).toBe(3)
      expect(facts.lines).toHaveLength(MAX_MANAGED_ITEMS_PER_TURN)
      expect(facts.lines.every((line) => line.includes('JawabanX'))).toBe(true)
      // Entri Y kehilangan SEMUA itemnya ke plafon -- sourceKey-nya tidak boleh nongol di refs
      // sama sekali, bukan cuma tidak punya baris.
      expect(facts.refs.map((r) => r.sourceKey)).toEqual(['managed/x'])
    })
  })

  // Task 12 (Ruling R46): the loader returns `{ entries: [], available: false }` on a failed
  // read (managed-knowledge.ts) -- the SAME shape as "nothing published". Without checking
  // `available` before the `entries.length === 0` early return, a read failure is invisible to
  // every caller. `degraded` is how the caller (orchestrator.ts) tells the two apart.
  describe('degraded (Ruling R46)', () => {
    it('flags degraded when the loader reports available: false', async () => {
      vi.mocked(loadPublishedManagedKnowledge).mockResolvedValue({ entries: [], available: false, loadedAt: 0 })
      const facts = await managedFactsFor('berapa harga paket ATV?', null)
      expect(facts.degraded).toBe(true)
    })

    it('flags degraded even when the customer message is stopword-only', async () => {
      // The `asked.size === 0` path and the `available === false` path are both early returns in
      // managedFactsFor -- this proves the availability check runs BEFORE either the entries or
      // the tokenised-message logic gets a chance to hide it as "nothing relevant found".
      vi.mocked(loadPublishedManagedKnowledge).mockResolvedValue({ entries: [], available: false, loadedAt: 0 })
      const facts = await managedFactsFor('berapa?', 'payment')
      expect(facts.degraded).toBe(true)
    })

    it('does not flag degraded when available: true with no entries at all', async () => {
      vi.mocked(loadPublishedManagedKnowledge).mockResolvedValue({ entries: [], available: true, loadedAt: 0 })
      const facts = await managedFactsFor('berapa harga paket ATV?', null)
      expect(facts.degraded).toBe(false)
    })

    it('does not flag degraded on an ordinary successful read with matching entries', async () => {
      vi.mocked(loadPublishedManagedKnowledge).mockResolvedValue({ entries: [entry()], available: true, loadedAt: 0 })
      const facts = await managedFactsFor('berapa harga paket ATV untuk 4 orang?', null)
      expect(facts.degraded).toBe(false)
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

// Ruling R27/R77 (Task 11): Mode 3 (booking_context) runs before topic classification, so it has
// no topic to gate on -- this function hands back EVERY PUBLISHED managed fact unconditionally
// (no topic gate), the Mode 3 equivalent of the old GENERAL_FAQ_FALLBACK constant. Fix round 1
// (R99): that is not the same as "always present" -- see the first test below. Nothing published
// (the real production state until Gerbang G5 runs) genuinely means zero facts here; the
// no-handoff-on-content-gap BEHAVIOUR is what stays guaranteed, not the presence of any
// particular fact.
describe('allManagedFacts', () => {
  it('returns the EMPTY shape when nothing is published', async () => {
    // `lineSources` is deliberately absent here, not `[]` -- same convention as
    // `managedFactsFor`'s own EMPTY shortcut (see ManagedFacts.lineSources' own header): an
    // absent key reads identically to an empty array everywhere this is consumed.
    expect(await allManagedFacts()).toEqual({
      lines: [],
      refs: [],
      gateBypassed: false,
      truncated: 0,
      rejected: [],
      rejectedOmitted: 0,
      degraded: false,
    })
  })

  it('returns every item from every entry, with no topic gate and no word-overlap filter', async () => {
    // Neither item shares a single word with anything -- managedFactsFor(topic: null) on this
    // same data would return nothing at all (no overlap), which is exactly the behaviour this
    // function must NOT have.
    vi.mocked(loadPublishedManagedKnowledge).mockResolvedValue({
      entries: [
        entry({
          sourceKey: 'managed/a',
          sourceTitle: 'FAQ A',
          version: 3,
          items: [
            { question: 'Zzyzx qqwerty?', answer: 'Unrelated answer one.', topics: ['payment'] },
            { question: 'Another unrelated question?', answer: 'Unrelated answer two.' },
          ],
        }),
      ],
      available: true,
      loadedAt: 0,
    })

    const facts = await allManagedFacts()

    expect(facts.lines).toEqual([
      'Zzyzx qqwerty? — Unrelated answer one.',
      'Another unrelated question? — Unrelated answer two.',
    ])
    expect(facts.lineSources).toEqual(['FAQ A (v3)', 'FAQ A (v3)'])
    expect(facts.refs).toEqual([{ sourceType: 'MANAGED', sourceKey: 'managed/a', title: 'FAQ A', version: 3 }])
  })

  it('emits standalone price and link lines, same as managedFactsFor', async () => {
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

    const facts = await allManagedFacts()

    expect(facts.lines).toEqual([
      'Berapa harga ATV? — Tergantung paket.',
      'ATV 1 jam: IDR 350000',
      'Detail: https://example.com/atv',
    ])
    expect(facts.lineSources).toEqual(['FAQ Harga ATV (v2)', 'FAQ Harga ATV (v2)', 'FAQ Harga ATV (v2)'])
  })

  it('never truncates, however many items are published — no MAX_MANAGED_ITEMS_PER_TURN cap', async () => {
    const items = Array.from({ length: MAX_MANAGED_ITEMS_PER_TURN + 5 }, (_, i) => ({
      question: `Pertanyaan nomor ${i}?`,
      answer: `Jawaban ${i}.`,
    }))
    vi.mocked(loadPublishedManagedKnowledge).mockResolvedValue({
      entries: [entry({ items })],
      available: true,
      loadedAt: 0,
    })

    const facts = await allManagedFacts()

    expect(facts.lines).toHaveLength(MAX_MANAGED_ITEMS_PER_TURN + 5)
    expect(facts.truncated).toBe(0)
  })

  it('always reports gateBypassed: false, rejected: [], rejectedOmitted: 0 — there is no gate to bypass or reject anything', async () => {
    vi.mocked(loadPublishedManagedKnowledge).mockResolvedValue({ entries: [entry()], available: true, loadedAt: 0 })
    const facts = await allManagedFacts()
    expect(facts.gateBypassed).toBe(false)
    expect(facts.rejected).toEqual([])
    expect(facts.rejectedOmitted).toBe(0)
  })

  it('flags degraded when the loader throws, same contract as managedFactsFor (Ruling R46)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(loadPublishedManagedKnowledge).mockRejectedValue(new Error('db down'))
    const facts = await allManagedFacts()
    expect(facts.degraded).toBe(true)
    expect(facts.lines).toEqual([])
  })

  it('flags degraded when the loader reports available: false, distinct from "nothing published"', async () => {
    vi.mocked(loadPublishedManagedKnowledge).mockResolvedValue({ entries: [], available: false, loadedAt: 0 })
    const facts = await allManagedFacts()
    expect(facts.degraded).toBe(true)
  })
})

// Ruling R94 -- the deterministic replacement for the deferred eval run: for every EVAL_CASES
// turn whose answer came from a GENERAL_FAQ_FALLBACK block (deposit -> payment, gas mask ->
// inclusions, blue fire -> blue_fire), plus a `general` turn and a `route_endpoint` turn,
// `managedFactsFor` over FAQ_SEED_DATA-shaped managed entries resolves the expected fact line --
// and `allManagedFacts()` resolves all 11 blocks. No LLM, no DB: FAQ_SEED_DATA is the pure data
// module `scripts/seed-faq-knowledge.ts` writes verbatim, loaded here through the same mocked
// `loadPublishedManagedKnowledge` every other test in this file uses.
describe('R94 -- deterministic routing test over FAQ_SEED_DATA (replaces the deferred eval run)', () => {
  function managedEntriesFromSeed() {
    return FAQ_SEED_DATA.map((seed, i) =>
      entry({
        sourceId: `seed_${i}`,
        sourceKey: `managed/seed-${i}`,
        sourceTitle: seed.title,
        revisionId: `seed_${i}_rev1`,
        version: 1,
        items: [{ question: seed.question, answer: seed.answer, topics: seed.topics }],
      })
    )
  }

  beforeEach(() => {
    vi.mocked(loadPublishedManagedKnowledge).mockResolvedValue({
      entries: managedEntriesFromSeed(),
      available: true,
      loadedAt: 0,
    })
  })

  it('resolves the deposit line for a deposit question classified as payment', async () => {
    const facts = await managedFactsFor('How much is the deposit before I can confirm my booking?', 'payment')
    expect(facts.lines.some((l) => l.includes('Deposit: 20% of total to confirm booking.'))).toBe(true)
  })

  it('resolves the gas mask line for an inclusions question classified as inclusions', async () => {
    const facts = await managedFactsFor('Is a gas mask included for the Ijen hike?', 'inclusions')
    expect(facts.lines.some((l) => l.includes('Gas mask for Ijen hike (where applicable).'))).toBe(true)
  })

  it('resolves the "NOT guaranteed" blue fire line for a blue_fire question', async () => {
    const facts = await managedFactsFor('Can you guarantee we will see the blue fire?', 'blue_fire')
    expect(facts.lines.some((l) => l.includes('NOT guaranteed -- visibility depends on weather'))).toBe(true)
  })

  it('resolves the GENERAL block lines on a general turn', async () => {
    const facts = await managedFactsFor('Hi, just wondering about your tours in general', 'general')
    expect(facts.lines.some((l) => l.includes('All tours are 100% PRIVATE'))).toBe(true)
  })

  it('resolves the Ketapang-Gilimanuk ferry line for topic route_endpoint', async () => {
    const facts = await managedFactsFor('How does the ferry crossing to Bali work?', 'route_endpoint')
    expect(facts.lines.some((l) => l.includes('Ketapang-Gilimanuk ferry'))).toBe(true)
  })

  it('allManagedFacts() resolves all 11 seeded blocks', async () => {
    const facts = await allManagedFacts()
    expect(facts.lines).toHaveLength(FAQ_SEED_DATA.length)
    for (const seed of FAQ_SEED_DATA) {
      expect(facts.lines.some((l) => l === `${seed.question} — ${seed.answer}`)).toBe(true)
    }
  })
})

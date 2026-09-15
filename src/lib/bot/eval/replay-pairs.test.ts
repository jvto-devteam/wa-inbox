import { describe, it, expect, vi } from 'vitest'
import {
  buildOpeningPair,
  countBursts,
  seededShuffle,
  sweepReplayRows,
  REPLAY_PHONE_PREFIX,
  type PairOptions,
  type ReplayMessage,
} from './replay-pairs'

const T0 = new Date('2026-08-20T03:00:00Z').getTime()
const LONG_ADMIN =
  'Hello! Yes, we can arrange pickup at Surabaya Airport and drop-off in Ubud. The 3D2N private tour price for 2 pax is below.'

function msg(id: string, sentBy: ReplayMessage['sentBy'], content: string | null, offsetMs: number, type = 'text'): ReplayMessage {
  return { id, sentBy, type, content, createdAt: new Date(T0 + offsetMs) }
}

function options(broadcast: string[] = []): PairOptions {
  return { broadcastContents: new Set(broadcast), burstDebounceMs: 5000, burstMaxWaitMs: 25000 }
}

describe('buildOpeningPair', () => {
  it('memasangkan pesan pembuka pelanggan dengan blok balasan admin berikutnya', () => {
    const result = buildOpeningPair(
      'c1',
      [
        msg('m1', 'CUSTOMER', 'Hi, is a Bromo Ijen tour possible on 27 October?', 0),
        msg('m2', 'AGENT', LONG_ADMIN, 60_000),
        msg('m3', 'CUSTOMER', 'Great, thanks', 120_000),
        msg('m4', 'AGENT', 'You are welcome, here is the booking link for your tour.', 180_000),
      ],
      options()
    )

    expect(result).toEqual({
      ok: true,
      pair: {
        conversationId: 'c1',
        askedAt: new Date(T0),
        customerText: 'Hi, is a Bromo Ijen tour possible on 27 October?',
        customerMessageIds: ['m1'],
        productionBurstCount: 1,
        adminText: LONG_ADMIN,
        adminMessageIds: ['m2'],
        adminMediaCount: 0,
      },
    })
  })

  it('menggabungkan semua pesan pelanggan sebelum balasan dan menghitung burst produksinya', () => {
    const result = buildOpeningPair(
      'c1',
      [
        msg('m1', 'CUSTOMER', 'Hello', 0),
        msg('m2', 'CUSTOMER', 'We are 2 pax visiting East Java', 2_000),
        msg('m3', 'CUSTOMER', 'What is the price?', 90_000),
        msg('m4', 'AGENT', LONG_ADMIN, 200_000),
      ],
      options()
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.pair.customerText).toBe('Hello\nWe are 2 pax visiting East Java\nWhat is the price?')
    expect(result.pair.productionBurstCount).toBe(2)
  })

  it('mengabaikan reaksi emoji dan mengurutkan pesan menurut waktu', () => {
    const result = buildOpeningPair(
      'c1',
      [
        msg('m3', 'AGENT', LONG_ADMIN, 60_000),
        msg('r1', 'AGENT', '👍', 1_000, 'reaction'),
        msg('m1', 'CUSTOMER', 'Hi, is a Bromo Ijen tour possible on 27 October?', 0),
      ],
      options()
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.pair.adminMessageIds).toEqual(['m3'])
  })

  it('membuang broadcast dari balasan admin tapi tetap memakai jawaban aslinya', () => {
    const broadcast = 'Hi Sir/Madam, Mount Bromo has been temporarily closed for all visitors.'
    const result = buildOpeningPair(
      'c1',
      [
        msg('m1', 'CUSTOMER', 'Hi, is a Bromo Ijen tour possible on 27 October?', 0),
        msg('m2', 'AGENT', broadcast, 30_000),
        msg('m3', 'AGENT', LONG_ADMIN, 60_000),
        msg('m4', 'AGENT', null, 61_000, 'image'),
      ],
      options([broadcast])
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.pair.adminText).toBe(LONG_ADMIN)
    expect(result.pair.adminMessageIds).toEqual(['m3'])
    expect(result.pair.adminMediaCount).toBe(1)
  })

  it.each([
    ['tanpa_pesan', []],
    ['tidak_dibuka_pelanggan', [msg('m1', 'AGENT', LONG_ADMIN, 0), msg('m2', 'CUSTOMER', 'Hi, how much is the tour for two?', 1)]],
    ['pembuka_bukan_teks', [msg('m1', 'CUSTOMER', null, 0, 'image'), msg('m2', 'AGENT', LONG_ADMIN, 1)]],
    ['pembuka_terlalu_pendek', [msg('m1', 'CUSTOMER', 'Hello', 0), msg('m2', 'AGENT', LONG_ADMIN, 1)]],
    ['tanpa_balasan', [msg('m1', 'CUSTOMER', 'Hi, how much is the tour for two?', 0)]],
    ['dibalas_bot', [msg('m1', 'CUSTOMER', 'Hi, how much is the tour for two?', 0), msg('m2', 'BOT', LONG_ADMIN, 1)]],
    [
      'balasan_admin_hanya_broadcast_atau_pendek',
      [msg('m1', 'CUSTOMER', 'Hi, how much is the tour for two?', 0), msg('m2', 'AGENT', 'Hello!', 1)],
    ],
    [
      'balasan_kondisi_darurat',
      [
        msg('m1', 'CUSTOMER', 'Hi, how much is the tour for two?', 0),
        msg('m2', 'AGENT', 'Sorry, due to the forest fire around Ijen we cannot run tours until further notice.', 1),
      ],
    ],
  ] as const)('melewati percakapan dengan alasan %s', (reason, messages) => {
    expect(buildOpeningPair('c1', [...messages], options())).toEqual({ ok: false, reason })
  })
})

describe('countBursts', () => {
  it('membuka burst baru saat jeda mencapai debounce', () => {
    expect(countBursts([new Date(0), new Date(4_999), new Date(9_998)], 5000, 25000)).toBe(1)
    expect(countBursts([new Date(0), new Date(5_000)], 5000, 25000)).toBe(2)
  })

  it('membuka burst baru saat batas maxWait sejak pesan pertama terlampaui', () => {
    const everyFourSeconds = [0, 4_000, 8_000, 12_000, 16_000, 20_000, 24_000, 28_000].map((t) => new Date(t))
    expect(countBursts(everyFourSeconds, 5000, 25000)).toBe(2)
  })
})

describe('seededShuffle', () => {
  it('deterministik untuk seed yang sama dan tetap permutasi dari masukan', () => {
    const items = Array.from({ length: 50 }, (_, i) => i)
    const first = seededShuffle(items, 20260915)
    expect(seededShuffle(items, 20260915)).toEqual(first)
    expect([...first].sort((a, b) => a - b)).toEqual(items)
    expect(first).not.toEqual(items)
  })
})

describe('sweepReplayRows', () => {
  it('menghapus Message, lalu Conversation, lalu Contact, semuanya dibatasi prefix replay-', async () => {
    const calls: string[] = []
    const record = (name: string) => vi.fn(async () => {
      calls.push(name)
      return { count: 0 }
    })
    const client = {
      message: { deleteMany: record('message') },
      conversation: { deleteMany: record('conversation') },
      contact: { deleteMany: record('contact') },
    }

    await sweepReplayRows(client as unknown as Parameters<typeof sweepReplayRows>[0])

    expect(calls).toEqual(['message', 'conversation', 'contact'])
    const byPrefix = { phone: { startsWith: REPLAY_PHONE_PREFIX } }
    expect(client.message.deleteMany).toHaveBeenCalledWith({ where: { conversation: { contact: byPrefix } } })
    expect(client.conversation.deleteMany).toHaveBeenCalledWith({ where: { contact: byPrefix } })
    expect(client.contact.deleteMany).toHaveBeenCalledWith({ where: byPrefix })
    expect(REPLAY_PHONE_PREFIX).toBe('replay-')
  })
})

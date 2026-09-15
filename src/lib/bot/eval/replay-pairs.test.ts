import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect, vi } from 'vitest'
import {
  ADMIN_REPLY_WINDOW_MS,
  FALLBACK_STEP_LABELS,
  LLM_FALLBACK_DETAIL,
  buildOpeningPair,
  countBursts,
  degradedReason,
  jakartaDay,
  parseBookingDay,
  seededShuffle,
  sweepReplayRows,
  REPLAY_PHONE_PREFIX,
  type PairOptions,
  type ReplayMessage,
} from './replay-pairs'

const T0 = new Date('2026-08-20T03:00:00Z').getTime()
const LONG_ADMIN =
  'Hello! Yes, we can arrange pickup at Surabaya Airport and drop-off in Ubud. The 3D2N private tour price for 2 pax is below.'
const QUESTION = 'Hi, is a Bromo Ijen tour possible on 27 October?'

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
        msg('m1', 'CUSTOMER', QUESTION, 0),
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
        customerText: QUESTION,
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
      [msg('m3', 'AGENT', LONG_ADMIN, 60_000), msg('r1', 'AGENT', '👍', 1_000, 'reaction'), msg('m1', 'CUSTOMER', QUESTION, 0)],
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
        msg('m1', 'CUSTOMER', QUESTION, 0),
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

  it('membuang notifikasi booking otomatis [JVTO] dari jawaban admin (replay tahap 2 #31)', () => {
    const result = buildOpeningPair(
      'c1',
      [
        msg('m1', 'CUSTOMER', QUESTION, 0),
        msg('m2', 'AGENT', LONG_ADMIN, 60_000),
        msg('m3', 'AGENT', '*[JVTO] Booking Pending — Payment Required* ⏳\n\nHi, thank you for booking with JVTO.', 120_000),
        msg('m4', 'AGENT', '*[JVTO] Booking Confirmed — Payment Received* ✅🎉\n\nYour booking is now confirmed.', 180_000, 'image'),
      ],
      options()
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.pair.adminMessageIds).toEqual(['m2'])
    expect(result.pair.adminText).toBe(LONG_ADMIN)
  })

  it('tidak membuang jawaban admin yang hanya menyebut [JVTO] di tengah kalimat', () => {
    const answer = 'Hello! The booking confirmation will arrive titled [JVTO] Booking Confirmed once the deposit is paid.'
    const result = buildOpeningPair('c1', [msg('m1', 'CUSTOMER', QUESTION, 0), msg('m2', 'AGENT', answer, 60_000)], options())

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.pair.adminMessageIds).toEqual(['m2'])
  })

  it('hanya menghitung pesan admin dalam jendela sejak balasan pertamanya', () => {
    const first = 60_000
    const result = buildOpeningPair(
      'c1',
      [
        msg('m1', 'CUSTOMER', QUESTION, 0),
        msg('m2', 'AGENT', LONG_ADMIN, first),
        msg('m3', 'AGENT', 'For 3 participants we provide a private MPV such as a Toyota Avanza.', first + ADMIN_REPLY_WINDOW_MS),
        msg('m4', 'AGENT', '[JVTO] Booking Pending -- Payment Required. Please complete your deposit payment.', first + ADMIN_REPLY_WINDOW_MS + 1),
        msg('m5', 'AGENT', null, first + 8 * 60 * 60 * 1000, 'image'),
      ],
      options()
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.pair.adminMessageIds).toEqual(['m2', 'm3'])
    expect(result.pair.adminMediaCount).toBe(0)
  })

  it('melewati pelanggan yang booking-nya dibuat pada atau sebelum hari bertanya (WIB)', () => {
    const messages = [msg('m1', 'CUSTOMER', QUESTION, 0), msg('m2', 'AGENT', LONG_ADMIN, 60_000)]
    // T0 = 2026-08-20 03:00 UTC = 2026-08-20 10:00 WIB
    expect(buildOpeningPair('c1', messages, options(), '2026-06-28')).toEqual({ ok: false, reason: 'sudah_booking_saat_bertanya' })
    expect(buildOpeningPair('c1', messages, options(), '2026-08-20')).toEqual({ ok: false, reason: 'sudah_booking_saat_bertanya' })
    expect(buildOpeningPair('c1', messages, options(), '2026-08-21').ok).toBe(true)
    expect(buildOpeningPair('c1', messages, options(), null).ok).toBe(true)
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

describe('parseBookingDay', () => {
  it('membaca format booking_date API booking', () => {
    expect(parseBookingDay('03 Sep 2026')).toBe('2026-09-03')
    expect(parseBookingDay('7 Aug 2026')).toBe('2026-08-07')
  })

  it.each([null, undefined, 20260903, '', '2026-09-03', '03 Sept 2026', '03 Xyz 2026'])('mengembalikan null untuk %s', (value) => {
    expect(parseBookingDay(value)).toBeNull()
  })
})

describe('jakartaDay', () => {
  it('memakai kalender Asia/Jakarta, bukan UTC', () => {
    expect(jakartaDay(new Date('2026-09-02T16:59:59Z'))).toBe('2026-09-02')
    expect(jakartaDay(new Date('2026-09-02T17:00:00Z'))).toBe('2026-09-03')
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

describe('degradedReason', () => {
  const healthy = [
    { label: 'Pesan diterima', detail: 'Memeriksa apakah pesan mengandung kata kunci eskalasi.' },
    { label: 'Mengklasifikasi topik', detail: 'Topik terdeteksi: "price".' },
  ]

  it('null untuk giliran yang sehat', () => {
    expect(degradedReason(healthy)).toBeNull()
  })

  it('menandai classifier yang jatuh ke regex karena LLM gagal/timeout (replay tahap 1 #3)', () => {
    const steps = [...healthy, { label: 'Mengklasifikasi topik', detail: 'Topik terdeteksi: "price" (fallback regex -- model LLM gagal/timeout).' }]
    expect(degradedReason(steps)).toBe('Mengklasifikasi topik: LLM gagal/timeout')
  })

  it.each(FALLBACK_STEP_LABELS)('menandai jalur cadangan "%s"', (label) => {
    expect(degradedReason([...healthy, { label, detail: 'tetap dijawab dengan pesan cadangan' }])).toBe(label)
  })

  it('setiap label dan pola yang dicari benar-benar ada di orchestrator.ts', () => {
    const source = readFileSync(path.join(__dirname, '..', 'orchestrator.ts'), 'utf8')
    for (const label of FALLBACK_STEP_LABELS) expect(source).toContain(`'${label}'`)
    expect(source.match(new RegExp(LLM_FALLBACK_DETAIL.source, 'gi'))?.length ?? 0).toBeGreaterThanOrEqual(5)
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
    const record = (name: string) =>
      vi.fn(async () => {
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

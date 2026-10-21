import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import { Prisma, type PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { reevaluateBookingActions } from '@/lib/booking-actions/store'
import { lookupBooking, lookupBookingResult, ensureFreshBookingData, refreshBookingDataForOpenActions, refreshStaleBookingData, OPEN_ACTION_REFRESH_MS } from './client'

import type { MockedFunction } from 'vitest'

// `fetch` is re-stubbed on every beforeEach, so the handle is resolved lazily instead of
// bound once at module scope -- binding it once would keep pointing at the previous test's
// stub. The stubbed value stays loose because these tests hand fetch deliberately partial
// Response fixtures (ok + text only); the call tuple gets its real shape back at the point
// of inspection instead, which is where the types actually earn something.
const mockFetch = () => fetch as unknown as MockedFunction<(...args: never[]) => unknown>
type FetchInit = { method?: string; body: string; signal?: AbortSignal | null; headers: Record<string, string | undefined> }
const fetchCall = (index = 0) => mockFetch().mock.calls[index] as unknown as [string, FetchInit]

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/booking-actions/store', () => ({ reevaluateBookingActions: vi.fn() }))
const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  process.env.BOOKING_API_URL = 'https://booking.jvto.example/bookings'
  process.env.BOOKING_API_KEY = 'booking-key'
  mockReset(mockPrisma)
  vi.mocked(reevaluateBookingActions).mockReset().mockResolvedValue({ resolved: 0, opened: 0 })
  mockPrisma.conversation.update.mockResolvedValue({} as never)
})

describe('lookupBooking', () => {
  it('returns null when BOOKING_API_URL is not configured, without calling fetch', async () => {
    delete process.env.BOOKING_API_URL
    expect(await lookupBooking('6281234567890')).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('builds the request URL with filter_type=range, a date_range from the 1st of last month, and phone_no; sends a Bearer Authorization header', async () => {
    ;mockFetch().mockResolvedValue({ ok: true, text: async () => JSON.stringify(({ id: 'B1' })) })

    await lookupBooking('+62 812-3456-7890')

    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, options] = fetchCall(0)
    // Phone is normalized (spaces/dashes stripped) and the '+' is kept as a
    // literal character in the query string (not percent-encoded to %2B).
    expect(url).toMatch(
      /^https:\/\/booking\.jvto\.example\/bookings\?filter_type=range&date_range=\d{4}-\d{2}-01_2099-12-31&phone_no=\+6281234567890$/
    )
    expect(options.headers.Authorization).toBe('Bearer booking-key')
    expect(options.signal).toBeInstanceOf(AbortSignal)
  })

  it('omits the Authorization header when BOOKING_API_KEY is not set', async () => {
    delete process.env.BOOKING_API_KEY
    ;mockFetch().mockResolvedValue({ ok: true, text: async () => JSON.stringify(({ id: 'B1' })) })

    await lookupBooking('6281234567890')

    const [, options] = fetchCall(0)
    expect(options.headers.Authorization).toBeUndefined()
  })

  it('returns the raw booking object as-is when the API returns a single object (no field remapping)', async () => {
    const raw = {
      id: 'B1',
      guest: 'Jane Doe',
      package: 'Ijen Blue Fire Trekking',
      date: { start: '01 Aug 2026', end: '02 Aug 2026', start_ymd: '2026-08-01', end_ymd: '2026-08-02' },
      orderChannel: 'JVTO',
      financial: { payment: 500000, balance: 350000 },
    }
    ;mockFetch().mockResolvedValue({ ok: true, text: async () => JSON.stringify(raw) })

    const result = await lookupBooking('6281234567890')

    expect(result).toEqual(raw)
  })

  it('picks the booking with the latest date.start_ymd when the API returns an array', async () => {
    ;mockFetch().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify([
        { id: 'B1', date: { start_ymd: '2026-08-01' } },
        { id: 'B2', date: { start_ymd: '2026-09-01' } },
        { id: 'B3', date: { start_ymd: '2026-07-15' } },
      ]),
    })

    const result = await lookupBooking('6281234567890')

    expect(result?.id).toBe('B2')
  })

  it('returns null when the API returns an empty array', async () => {
    ;mockFetch().mockResolvedValue({ ok: true, text: async () => JSON.stringify([]) })
    expect(await lookupBooking('6281234567890')).toBeNull()
  })

  it('returns null when the API returns an empty object', async () => {
    ;mockFetch().mockResolvedValue({ ok: true, text: async () => JSON.stringify(({})) })
    expect(await lookupBooking('6281234567890')).toBeNull()
  })

  it('handles array items with a missing date gracefully instead of throwing', async () => {
    ;mockFetch().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify([{ id: 'B1' }, { id: 'B2', date: { start_ymd: '2026-09-01' } }]),
    })

    const result = await lookupBooking('6281234567890')

    expect(result?.id).toBe('B2')
  })

  it('returns null when the response is not ok (e.g. 404 or 500)', async () => {
    ;mockFetch().mockResolvedValue({ ok: false, status: 500, text: async () => JSON.stringify(({})) })
    expect(await lookupBooking('6281234567890')).toBeNull()
  })

  it('returns null instead of throwing when the request fails outright', async () => {
    ;mockFetch().mockRejectedValue(new Error('timeout'))
    expect(await lookupBooking('6281234567890')).toBeNull()
  })

  it('returns null instead of throwing when the response body is not valid JSON', async () => {
    ;mockFetch().mockResolvedValue({
      ok: true,
      text: async () => '<html>not json',
    })
    expect(await lookupBooking('6281234567890')).toBeNull()
  })
})

describe('lookupBookingResult: empty 200 body (2026-10-21, booking deleted)', () => {
  it('an empty or "null" body (backoffice ->first() found nothing) is a valid "no booking", not an error', async () => {
    ;mockFetch().mockResolvedValue({ ok: true, text: async () => '' })
    expect(await lookupBookingResult('6282143403501')).toEqual({ status: 'not_found' })
    ;mockFetch().mockResolvedValue({ ok: true, text: async () => 'null' })
    expect(await lookupBookingResult('6282143403501')).toEqual({ status: 'not_found' })
  })

  it('a non-empty body that is not JSON stays an error (never wipes bookingData)', async () => {
    ;mockFetch().mockResolvedValue({ ok: true, text: async () => '<html>Server Error</html>' })
    expect(await lookupBookingResult('6282143403501')).toEqual({ status: 'error' })
  })
})

describe('ensureFreshBookingData', () => {
  it('returns the cached bookingData without calling the API when it was checked recently', async () => {
    const conversation = {
      id: 'conv_1',
      bookingData: { id: 'B1', guest: 'Bruno' },
      bookingCheckedAt: new Date(),
      pipelineStage: 'new',
      contact: { phone: '6281234567890' },
    }

    const result = await ensureFreshBookingData(conversation)

    expect(result).toEqual({ id: 'B1', guest: 'Bruno' })
    expect(fetch).not.toHaveBeenCalled()
    // Cache hit TIDAK memperpanjang stempel waktunya: kalau `bookingCheckedAt` ikut ditulis di
    // sini, cache-nya diperbarui tanpa pernah benar-benar memanggil API booking.
    const written = mockPrisma.conversation.update.mock.calls[0]?.[0]?.data ?? {}
    expect(written).not.toHaveProperty('bookingCheckedAt')
    expect(written).not.toHaveProperty('bookingData')
  })

  it('menaikkan tahap dari data yang SUDAH ter-cache, tanpa memanggil API booking', async () => {
    // Regresi bug yang dilaporkan: percakapan yang jelas punya booking tetap berlencana "Baru".
    // Dulu penurunan tahap ada di dalam `if (stale)`, jadi percakapan yang datanya masih segar
    // tidak pernah dinilai ulang -- padahal `deriveStageFromBooking` sebagian bergantung waktu.
    const conversation = {
      id: 'conv_1',
      bookingData: { id: 'B1', guest: 'Bruno', financial: { balance: 0 } },
      bookingCheckedAt: new Date(),
      pipelineStage: 'new',
      contact: { phone: '6281234567890' },
    }

    await ensureFreshBookingData(conversation)

    expect(fetch).not.toHaveBeenCalled()
    expect(mockPrisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'conv_1' },
      data: { pipelineStage: 'lunas' },
    })
  })

  it('tidak menulis apa pun saat tahapnya sudah benar', async () => {
    const conversation = {
      id: 'conv_1',
      bookingData: { id: 'B1', guest: 'Bruno', financial: { balance: 0 } },
      bookingCheckedAt: new Date(),
      pipelineStage: 'lunas',
      orderChannel: 'JVTO',
      contact: { phone: '6281234567890' },
    }

    await ensureFreshBookingData(conversation)

    expect(mockPrisma.conversation.update).not.toHaveBeenCalled()
  })

  it('tidak pernah memundurkan tahap yang sudah disetel agen lebih maju', async () => {
    const conversation = {
      id: 'conv_1',
      bookingData: { id: 'B1', guest: 'Bruno', financial: { balance: 500000 } },
      bookingCheckedAt: new Date(),
      pipelineStage: 'selesai',
      orderChannel: 'JVTO',
      contact: { phone: '6281234567890' },
    }

    await ensureFreshBookingData(conversation)

    expect(mockPrisma.conversation.update).not.toHaveBeenCalled()
  })

  it('returns null without ever calling the booking API for an isTest conversation, even with stale/no cache', async () => {
    // The sandbox conversation's sentinel phone has no digits, so normalizePhone() reduces it
    // to '' -- a real booking API could answer an empty phone_no filter with someone else's
    // most recent booking instead of erroring, leaking real customer data into the test room.
    const conversation = {
      id: 'conv_test',
      bookingData: null,
      bookingCheckedAt: null,
      pipelineStage: 'new',
      isTest: true,
      contact: { phone: '__bot_test__' },
    }

    const result = await ensureFreshBookingData(conversation)

    expect(result).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
    expect(mockPrisma.conversation.update).not.toHaveBeenCalled()
  })

  it('refetches when bookingCheckedAt is null (never checked)', async () => {
    ;mockFetch().mockResolvedValue({ ok: true, text: async () => JSON.stringify(({ id: 'B1', guest: 'Bruno' })) })
    const conversation = { id: 'conv_1', bookingData: null, bookingCheckedAt: null, pipelineStage: 'new', contact: { phone: '6281234567890' } }

    const result = await ensureFreshBookingData(conversation)

    expect(result).toEqual({ id: 'B1', guest: 'Bruno' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('refetches when the cached value is older than 24h', async () => {
    ;mockFetch().mockResolvedValue({ ok: true, text: async () => JSON.stringify(({ id: 'B2' })) })
    const stale = new Date(Date.now() - 25 * 60 * 60 * 1000)
    const conversation = { id: 'conv_1', bookingData: { id: 'B1' }, bookingCheckedAt: stale, pipelineStage: 'new', contact: { phone: '6281234567890' } }

    const result = await ensureFreshBookingData(conversation)

    expect(result).toEqual({ id: 'B2' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('does not refetch when the cached value is under 24h old', async () => {
    const fresh = new Date(Date.now() - 60 * 60 * 1000)
    const conversation = { id: 'conv_1', bookingData: { id: 'B1' }, bookingCheckedAt: fresh, pipelineStage: 'new', contact: { phone: '6281234567890' } }

    await ensureFreshBookingData(conversation)

    expect(fetch).not.toHaveBeenCalled()
  })

  // Regression guard for the `bookingData: null as never` crash. The mocked Prisma
  // client can't reject a plain `null` the way the real client does at runtime (the
  // mock accepts any argument), so this unit test structurally cannot catch this
  // class of bug by observing behaviour — `npx tsc --noEmit` is the real proof, since
  // `null` is genuinely unassignable to `NullableJsonNullValueInput | InputJsonValue`
  // and only an `as never` cast would suppress that error. What this test CAN pin
  // down is the exact `data` object handed to Prisma.
  it('writes Prisma.DbNull (never plain null) when no booking is found, so bookingCheckedAt still persists', async () => {
    ;mockFetch().mockResolvedValue({ ok: true, text: async () => JSON.stringify(({})) })
    const conversation = { id: 'conv_1', bookingData: null, bookingCheckedAt: null, pipelineStage: 'new', contact: { phone: '6281234567890' } }

    const result = await ensureFreshBookingData(conversation)

    expect(result).toBeNull()
    expect(mockPrisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'conv_1' },
      data: { bookingData: Prisma.DbNull, bookingCheckedAt: expect.any(Date) },
    })
  })

  it('writes the raw booking object through unchanged when a booking is found', async () => {
    ;mockFetch().mockResolvedValue({ ok: true, text: async () => JSON.stringify(({ id: 'B1', guest: 'Bruno' })) })
    // pipelineStage starts at 'lunas' (outranks the 'booked' this booking would otherwise
    // derive) specifically so this test's assertion isn't also asserting on the pipeline
    // auto-advance behavior -- that has its own describe block below.
    const conversation = { id: 'conv_1', bookingData: null, bookingCheckedAt: null, pipelineStage: 'lunas', contact: { phone: '6281234567890' } }

    await ensureFreshBookingData(conversation)

    expect(mockPrisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'conv_1' },
      data: { bookingData: { id: 'B1', guest: 'Bruno' }, bookingCheckedAt: expect.any(Date) },
    })
  })
})

describe('ensureFreshBookingData — pipeline auto-advance', () => {
  function conversationWith(pipelineStage: string) {
    return { id: 'conv_1', bookingData: null, bookingCheckedAt: null, pipelineStage, contact: { phone: '6281234567890' } }
  }

  it('advances a new/nego conversation to "booked" once a real booking is found with no balance/end-date info', async () => {
    ;mockFetch().mockResolvedValue({ ok: true, text: async () => JSON.stringify(({ id: 'B1' })) })

    await ensureFreshBookingData(conversationWith('nego'))

    expect(mockPrisma.conversation.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ pipelineStage: 'booked' }),
    }))
  })

  it('advances straight to "lunas" once the booking\'s outstanding balance is zero', async () => {
    ;mockFetch().mockResolvedValue({ ok: true, text: async () => JSON.stringify(({ id: 'B1', financial: { balance: 0 } })) })

    await ensureFreshBookingData(conversationWith('new'))

    expect(mockPrisma.conversation.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ pipelineStage: 'lunas' }),
    }))
  })

  it('does not treat a positive outstanding balance as paid', async () => {
    ;mockFetch().mockResolvedValue({ ok: true, text: async () => JSON.stringify(({ id: 'B1', financial: { balance: 350000 } })) })

    await ensureFreshBookingData(conversationWith('new'))

    expect(mockPrisma.conversation.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ pipelineStage: 'booked' }),
    }))
  })

  it('advances to "selesai" once the trip\'s own end date has passed', async () => {
    ;mockFetch().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify(({ id: 'B1', financial: { balance: 350000 }, date: { end_ymd: '2020-01-01' } })),
    })

    await ensureFreshBookingData(conversationWith('booked'))

    expect(mockPrisma.conversation.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ pipelineStage: 'selesai' }),
    }))
  })

  it('does not advance to "selesai" for a future end date', async () => {
    ;mockFetch().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify(({ id: 'B1', date: { end_ymd: '2099-01-01' } })),
    })

    await ensureFreshBookingData(conversationWith('booked'))

    expect(mockPrisma.conversation.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.not.objectContaining({ pipelineStage: expect.anything() }),
    }))
  })

  it('never moves the stage backward past what an agent already set (lunas stays lunas even though this booking only derives "booked")', async () => {
    ;mockFetch().mockResolvedValue({ ok: true, text: async () => JSON.stringify(({ id: 'B1' })) })

    await ensureFreshBookingData(conversationWith('lunas'))

    const call = mockPrisma.conversation.update.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(call.data).not.toHaveProperty('pipelineStage')
  })

  it('does not touch pipelineStage when no booking is found at all', async () => {
    ;mockFetch().mockResolvedValue({ ok: true, text: async () => JSON.stringify(({})) })

    await ensureFreshBookingData(conversationWith('new'))

    const call = mockPrisma.conversation.update.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(call.data).not.toHaveProperty('pipelineStage')
  })

  it('treats an unrecognized current pipelineStage as rank -1, so it still advances', async () => {
    ;mockFetch().mockResolvedValue({ ok: true, text: async () => JSON.stringify(({ id: 'B1' })) })

    await ensureFreshBookingData(conversationWith('some_custom_stage'))

    expect(mockPrisma.conversation.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ pipelineStage: 'booked' }),
    }))
  })
})

describe('API booking gagal tidak menghapus data booking', () => {
  const STALE = new Date(Date.now() - 25 * 60 * 60 * 1000)
  const cached = () => ({ id: 'conv_1', bookingData: { id: 'B1', guest: 'Bruno' }, bookingCheckedAt: STALE, pipelineStage: 'lunas', contact: { phone: '6281234567890' } })

  it.each([
    ['timeout', () => mockFetch().mockRejectedValue(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }))],
    ['status non-OK', () => mockFetch().mockResolvedValue({ ok: false, status: 503, text: async () => JSON.stringify(({})) })],
    ['exception saat membaca body', () => mockFetch().mockResolvedValue({ ok: true, text: async () => '<html>not json' })],
  ])('%s: lookupBookingResult = error, bookingData lama tetap, bookingCheckedAt tidak distempel', async (_name, arrange) => {
    arrange()
    expect(await lookupBookingResult('6281234567890')).toEqual({ status: 'error' })
    const result = await ensureFreshBookingData(cached())
    expect(result).toEqual({ id: 'B1', guest: 'Bruno' })
    // Tahap sudah benar (lunas) dan orderChannel tidak berubah: tidak ada tulisan sama sekali.
    expect(mockPrisma.conversation.update).not.toHaveBeenCalled()
  })

  it('API belum dikonfigurasi juga dianggap gagal, bukan "tanpa booking"', async () => {
    delete process.env.BOOKING_API_URL
    expect(await lookupBookingResult('6281234567890')).toEqual({ status: 'error' })
    await ensureFreshBookingData(cached())
    expect(mockPrisma.conversation.update).not.toHaveBeenCalled()
  })

  it('error tetap boleh menaikkan tahap dari data lama, tanpa menyentuh bookingData', async () => {
    ;mockFetch().mockResolvedValue({ ok: false, status: 500, text: async () => JSON.stringify(({})) })
    await ensureFreshBookingData({ ...cached(), pipelineStage: 'new' })
    const data = mockPrisma.conversation.update.mock.calls[0][0].data
    expect(data).not.toHaveProperty('bookingData')
    expect(data).not.toHaveProperty('bookingCheckedAt')
  })

  it('jawaban kosong yang sah tetap "tidak ditemukan": bookingData dikosongkan dan distempel', async () => {
    ;mockFetch().mockResolvedValue({ ok: true, text: async () => JSON.stringify([]) })
    expect(await lookupBookingResult('6281234567890')).toEqual({ status: 'not_found' })
    await ensureFreshBookingData(cached())
    expect(mockPrisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'conv_1' },
      data: { bookingData: Prisma.DbNull, bookingCheckedAt: expect.any(Date) },
    })
  })
})

describe('refreshStaleBookingData: batas waktu per tick', () => {
  it('berhenti begitu anggaran waktu habis; sisanya untuk tick berikutnya', async () => {
    const rows = ['a', 'b', 'c'].map((id) => ({ id, bookingData: null, bookingCheckedAt: null, pipelineStage: 'new', orderChannel: null, isTest: false, contact: { phone: '628123' } }))
    mockPrisma.conversation.findMany.mockResolvedValue(rows as never)
    let clock = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => clock)
    ;mockFetch().mockImplementation(async () => {
      clock += 40_000 // tiap panggilan API makan 40 detik
      return { ok: true, text: async () => JSON.stringify([]) }
    })
    expect(await refreshStaleBookingData(25, 60_000)).toEqual({ diperiksa: 2 })
    expect(fetch).toHaveBeenCalledTimes(2)
    vi.mocked(Date.now).mockRestore()
  })
})

describe('refreshStaleBookingData: yang terus gagal tidak menahan antrean (head-of-line)', () => {
  type Row = { id: string; bookingData: null; bookingCheckedAt: Date | null; pipelineStage: string; orderChannel: null; isTest: boolean; contact: { phone: string } }
  // Telepon '62800000NNNN'; 25 baris pertama (terlama) selalu gagal di API booking.
  const phone = (i: number) => `62800${String(i).padStart(6, '0')}`
  const makePool = (n: number): Row[] =>
    Array.from({ length: n }, (_, i) => ({ id: `c${i}`, bookingData: null, bookingCheckedAt: null, pipelineStage: 'new', orderChannel: null, isTest: false, contact: { phone: phone(i) } }))
  const FAILING = 25

  /** PRNG bertenaga tetap (mulberry32) supaya acakan bisa diulang. */
  function seeded(seed: number): () => number {
    let a = seed >>> 0
    return () => {
      a = (a + 0x6d2b79f5) >>> 0
      let t = a
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  /** Tiruan DB: baris basi urut terlama dulu; yang berhasil distempel keluar dari kolam. */
  function arrange(n: number) {
    let stale = makePool(n)
    mockPrisma.conversation.findMany.mockImplementation(((args: { take?: number }) => Promise.resolve(stale.slice(0, args.take))) as never)
    mockPrisma.conversation.update.mockImplementation(((args: { where: { id: string }; data: { bookingCheckedAt?: Date } }) => {
      if (args.data.bookingCheckedAt) stale = stale.filter((r) => r.id !== args.where.id)
      return Promise.resolve({})
    }) as never)
    const failing = new Set(Array.from({ length: FAILING }, (_, i) => phone(i)))
    ;mockFetch().mockImplementation(async (...args: never[]) => {
      const requested = new URL(String(args[0])).searchParams.get('phone_no') ?? ''
      return failing.has(requested) ? { ok: false, status: 503, text: async () => JSON.stringify(({})) } : { ok: true, text: async () => JSON.stringify([]) }
    })
    return { remaining: () => stale.length }
  }

  it('mengambil kolam 100 terlama, mengerjakan paling banyak 25', async () => {
    arrange(120)
    expect(await refreshStaleBookingData(25, 60_000, { random: seeded(1) })).toEqual({ diperiksa: 25 })
    expect(mockPrisma.conversation.findMany.mock.calls[0][0]).toMatchObject({ take: 100 })
    expect(fetch).toHaveBeenCalledTimes(25)
  })

  it('baris di belakang 25 yang terus gagal akhirnya tersentuh', async () => {
    const db = arrange(60)
    // Tanpa acakan, setiap tick hanya mengulang 25 yang gagal dan 35 lainnya tidak pernah dicek.
    for (let tick = 0; tick < 20 && db.remaining() > FAILING; tick++) {
      await refreshStaleBookingData(25, 60_000, { random: seeded(tick + 1) })
    }
    expect(db.remaining()).toBe(FAILING)
  })

  it('tanpa acakan (random = 0.999… → urutan asli) tick pertama hanya mengerjakan 25 terlama', async () => {
    const db = arrange(60)
    // random mendekati 1 membuat Fisher-Yates menukar setiap elemen dengan dirinya sendiri.
    await refreshStaleBookingData(25, 60_000, { random: () => 0.9999999 })
    expect(db.remaining()).toBe(60)
  })
})

describe('ensureFreshBookingData — reevaluate booking actions', () => {
  const base = { id: 'conv_1', bookingData: null, bookingCheckedAt: null, pipelineStage: 'new', contact: { phone: '6281234567890' } }

  it('refresh triggers reevaluate after bookingData is rewritten', async () => {
    ;mockFetch().mockResolvedValue({ ok: true, text: async () => JSON.stringify(({ id: 'B1' })) })
    await ensureFreshBookingData(base)
    expect(reevaluateBookingActions).toHaveBeenCalledWith('conv_1')
    const updateOrder = mockPrisma.conversation.update.mock.invocationCallOrder[0]
    expect(vi.mocked(reevaluateBookingActions).mock.invocationCallOrder[0]).toBeGreaterThan(updateOrder)
  })

  it('does not reevaluate on a cache hit', async () => {
    await ensureFreshBookingData({ ...base, bookingData: { id: 'B1' }, bookingCheckedAt: new Date() })
    expect(reevaluateBookingActions).not.toHaveBeenCalled()
  })

  it('does not reevaluate when the booking API errored (bookingData not rewritten)', async () => {
    ;mockFetch().mockRejectedValue(new Error('timeout'))
    await ensureFreshBookingData({ ...base, bookingData: { id: 'B1' } })
    expect(reevaluateBookingActions).not.toHaveBeenCalled()
  })

  it('a reevaluate failure is logged only and never breaks the refresh', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    ;mockFetch().mockResolvedValue({ ok: true, text: async () => JSON.stringify(({ id: 'B1' })) })
    vi.mocked(reevaluateBookingActions).mockRejectedValue(new Error('db'))
    await expect(ensureFreshBookingData(base)).resolves.toEqual(expect.objectContaining({ id: 'B1' }))
  })
})

describe('refreshBookingDataForOpenActions (final review Critical 1: tick refresh)', () => {
  const NOW = new Date('2026-10-20T03:00:00Z')
  const row = (id: string) => ({
    id, bookingData: { booking_id: 1 }, bookingCheckedAt: new Date(NOW.getTime() - 40 * 60 * 1000), pipelineStage: 'booked', orderChannel: null, isTest: false, contact: { phone: '4915112345678' },
  })

  it('only conversations with an OPEN CHANGE/TASK/MISMATCH and data older than 30 min, oldest first, capped', async () => {
    mockPrisma.conversation.findMany.mockResolvedValue([] as never)
    await refreshBookingDataForOpenActions(10, 30_000, NOW)
    const args = mockPrisma.conversation.findMany.mock.calls[0][0]
    expect(args?.where).toEqual({
      isTest: false,
      bookingData: { not: Prisma.DbNull },
      bookingActions: { some: { state: 'OPEN', type: { in: ['CHANGE', 'TASK', 'MISMATCH'] } } },
      OR: [{ bookingCheckedAt: null }, { bookingCheckedAt: { lt: new Date(NOW.getTime() - OPEN_ACTION_REFRESH_MS) } }],
    })
    expect(args?.take).toBe(10)
    expect(args?.orderBy).toEqual({ bookingCheckedAt: { sort: 'asc', nulls: 'first' } })
  })

  it('forces a lookup even though the 24 h cache is still valid, saves it and re-evaluates', async () => {
    mockPrisma.conversation.findMany.mockResolvedValue([row('c1')] as never)
    ;mockFetch().mockResolvedValue({ ok: true, text: async () => JSON.stringify([{ booking_id: 1, date: { start_ymd: '2099-01-01', end_ymd: '2099-01-02' } }]) })
    expect(await refreshBookingDataForOpenActions(10, 30_000, NOW)).toEqual({ diperiksa: 1 })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(mockPrisma.conversation.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'c1' }, data: expect.objectContaining({ bookingCheckedAt: expect.any(Date) }) }))
  })

  it('API failure stamps nothing (retried next tick) and never throws', async () => {
    mockPrisma.conversation.findMany.mockResolvedValue([row('c1')] as never)
    ;mockFetch().mockResolvedValue({ ok: false, status: 500 })
    expect(await refreshBookingDataForOpenActions(10, 30_000, NOW)).toEqual({ diperiksa: 1 })
    expect(mockPrisma.conversation.update).not.toHaveBeenCalled()
    mockPrisma.conversation.findMany.mockRejectedValue(new Error('db'))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(await refreshBookingDataForOpenActions(10, 30_000, NOW)).toEqual({ diperiksa: 0 })
  })

  it('stops when its share of the tick budget is spent', async () => {
    mockPrisma.conversation.findMany.mockResolvedValue([row('a'), row('b'), row('c')] as never)
    let clock = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => clock)
    ;mockFetch().mockImplementation(async () => {
      clock += 20_000
      return { ok: true, text: async () => JSON.stringify([]) }
    })
    expect(await refreshBookingDataForOpenActions(10, 30_000, NOW)).toEqual({ diperiksa: 2 })
    vi.mocked(Date.now).mockRestore()
  })
})
